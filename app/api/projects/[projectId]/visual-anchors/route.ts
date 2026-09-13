import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { callQwenImage } from "@/lib/image/qwenImageClient";
import {
  AnonymousProjectVersionConflictError,
  mutateOwnedAnonymousProject,
  requireOwnedAnonymousProject
} from "@/lib/projects/anonymousProjectStore";
import { projectNotFoundResponse, projectStoreErrorResponse, publicAnonymousProject } from "@/lib/projects/api";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent } from "@/lib/projects/generationEvents";
import { generateCharacterAnchorBriefs } from "@/lib/providers/deepseekProvider";
import type {
  CharacterVisualSpec,
  GenerationProject,
  SceneVisualSpec,
  VisualAnchorCandidate,
  VisualAnchorCandidateKind,
  VersionedResourceType
} from "@/lib/schemas/project";
import { getAnonymousApiSession } from "@/lib/session/api";
import { StageGateError, createResourceVersionInProject, currentResourceVersion } from "@/lib/workflow/stageGates";
import { buildCharacterCandidatePrompt, buildSceneCandidatePrompt, VISUAL_ANCHOR_NEGATIVE_PROMPT } from "@/lib/visual/anchorPrompts";
import { resolveProjectProductVisualSpec } from "@/lib/visual/productVisualSpec";
import {
  currentMasterAssetId,
  ensureVisualAnchorWorkspace,
  getVisualAnchorReadiness,
  getVisualAnchorResourceId,
  lockVisualAnchorMaster,
  replaceVisualAnchorCandidates,
  selectVisualAnchorCandidate
} from "@/lib/visual/visualAnchors";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("initialize"), expectedVersion: z.number().int().positive() }).strict(),
  z.object({
    action: z.literal("generate-candidates"),
    expectedVersion: z.number().int().positive(),
    kind: z.enum(["character", "scene"]),
    targetId: z.string().trim().min(1).max(120),
    count: z.number().int().min(2).max(3).default(3)
  }).strict(),
  z.object({
    action: z.literal("set-current"),
    expectedVersion: z.number().int().positive(),
    kind: z.enum(["character", "scene"]),
    targetId: z.string().trim().min(1).max(120),
    candidateId: z.string().uuid(),
    createVersion: z.boolean().optional()
  }).strict(),
  z.object({
    action: z.literal("lock-master"),
    expectedVersion: z.number().int().positive(),
    kind: z.enum(["product", "character", "scene"]),
    targetId: z.string().trim().min(1).max(120).optional()
  }).strict(),
  z.object({ action: z.literal("use-recommended"), expectedVersion: z.number().int().positive() }).strict()
]);

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = z.string().uuid().safeParse((await context.params).projectId);
  if (!projectId.success) return projectNotFoundResponse();
  try {
    const record = await requireOwnedAnonymousProject(sessionResult.session.id, projectId.data);
    const project = ensureVisualAnchorWorkspace(record.project);
    return NextResponse.json({ success: true, data: { ...publicAnonymousProject({ ...record, project }), readiness: getVisualAnchorReadiness(project) } });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? failure("VISUAL_ANCHOR_READ_FAILED", "视觉基准读取失败。", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = z.string().uuid().safeParse((await context.params).projectId);
  if (!projectId.success) return projectNotFoundResponse();
  try {
    const body = requestSchema.parse(await request.json());
    const current = await requireOwnedAnonymousProject(sessionResult.session.id, projectId.data);
    if (current.version !== body.expectedVersion) throw new AnonymousProjectVersionConflictError();

    if (body.action === "initialize") {
      return await initializeAnchors(sessionResult.session.id, projectId.data, current.project);
    }
    if (body.action === "generate-candidates") {
      return await generateCandidates(sessionResult.session.id, projectId.data, current.project, body);
    }
    if (body.action === "set-current") {
      const saved = await setCurrentCandidate(sessionResult.session.id, projectId.data, current.project, body, current.version);
      return NextResponse.json({ success: true, data: publicAnonymousProject(saved) });
    }
    if (body.action === "use-recommended") {
      const saved = await useRecommendedAnchors(sessionResult.session.id, projectId.data, current.project, current.version);
      return NextResponse.json({ success: true, data: publicAnonymousProject(saved) });
    }
    const saved = await lockMaster(sessionResult.session.id, projectId.data, current.project, body, current.version);
    return NextResponse.json({ success: true, data: publicAnonymousProject(saved) });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? mapAnchorError(error);
  }
}

async function useRecommendedAnchors(
  sessionId: string,
  projectId: string,
  source: GenerationProject,
  expectedVersion: number
) {
  return mutateOwnedAnonymousProject(sessionId, projectId, () => {
    let next = ensureVisualAnchorWorkspace(source);
    next = lockVisualAnchorMaster(next, "product");
    for (const targetId of next.visualAnchorWorkspace!.requiredCharacterIds) {
      const candidates = next.visualAnchorWorkspace!.characterCandidates.filter((item) => item.targetId === targetId && item.status !== "outdated");
      const candidate = candidates.find((item) => item.status === "selected") ?? candidates.find((item) => item.recommended) ?? candidates[0];
      if (!candidate) throw new Error("CHARACTER_MASTER_REQUIRED");
      next = selectVisualAnchorCandidate(next, "character", targetId, candidate.id);
      next = lockVisualAnchorMaster(next, "character", targetId);
    }
    for (const targetId of next.visualAnchorWorkspace!.requiredSceneIds) {
      const candidates = next.visualAnchorWorkspace!.sceneCandidates.filter((item) => item.targetId === targetId && item.status !== "outdated");
      const candidate = candidates.find((item) => item.status === "selected") ?? candidates.find((item) => item.recommended) ?? candidates[0];
      if (!candidate) throw new Error("SCENE_MASTER_REQUIRED");
      next = selectVisualAnchorCandidate(next, "scene", targetId, candidate.id);
      next = lockVisualAnchorMaster(next, "scene", targetId);
    }
    return ensureVisualAnchorWorkspace(next);
  }, expectedVersion);
}

async function initializeAnchors(sessionId: string, projectId: string, source: GenerationProject) {
  const event = await startGenerationEvent(sessionId, projectId, {
    stage: "anchors",
    provider: "deepseek",
    action: "Anchor Brief",
    message: "DeepSeek 正在根据已锁定创意整理人物需求与场景身份。"
  });
  try {
    const current = await requireOwnedAnonymousProject(sessionId, projectId);
    let project = ensureVisualAnchorWorkspace({ ...source, generationEvents: current.project.generationEvents });
    const productSpec = await resolveProjectProductVisualSpec({ sessionId, project }).catch((error) => ({
      spec: null,
      error: error instanceof Error ? error.message : "产品图片分析暂时不可用。"
    }));
    if (productSpec.spec) project = { ...project, productVisualSpec: productSpec.spec };
    const defaults = project.visualAnchorWorkspace!.characterBriefs;
    const generated = await generateCharacterAnchorBriefs(project.brief, project.creativeBible!, defaults, {
      sessionId,
      maxProviderAttempts: 1
    });
    if (generated.success && generated.data) {
      project = ensureVisualAnchorWorkspace({
        ...project,
        visualAnchorWorkspace: { ...project.visualAnchorWorkspace!, characterBriefs: generated.data }
      });
      project = applyCharacterBriefs(project, generated.data);
    }
    const saved = await mutateOwnedAnonymousProject(sessionId, projectId, () => project);
    await completeGenerationEvent(
      sessionId,
      projectId,
      event.id,
      generated.success
        ? "视觉基准需求已整理。下一步由用户分别生成人物与场景候选。"
        : "人物需求已使用现有 Creative Bible 整理；DeepSeek 未就绪，不影响已有视觉基准继续编辑。",
      { status: generated.success ? "completed" : "fallback" }
    );
    const final = await requireOwnedAnonymousProject(sessionId, projectId);
    return NextResponse.json({
      success: true,
      data: { ...publicAnonymousProject(final), readiness: getVisualAnchorReadiness(final.project) },
      trace: {
        provider: generated.provider,
        model: generated.model,
        fallbackUsed: !generated.success,
        productSpecStatus: productSpec.spec ? "ready" : "pending",
        productSpecError: productSpec.error ?? null
      }
    });
  } catch (error) {
    await failGenerationEvent(sessionId, projectId, event.id, "视觉基准初始化失败。", "PROVIDER_REQUEST_FAILED").catch(() => undefined);
    throw error;
  }
}

async function generateCandidates(
  sessionId: string,
  projectId: string,
  source: GenerationProject,
  body: Extract<z.infer<typeof requestSchema>, { action: "generate-candidates" }>
) {
  const project = ensureVisualAnchorWorkspace(source);
  const target = body.kind === "character"
    ? project.visualAnchorWorkspace!.characterBriefs.find((item) => item.id === body.targetId)
    : project.sceneVisualSpecs?.find((item) => item.id === body.targetId);
  if (!target) return failure("VISUAL_ANCHOR_TARGET_NOT_FOUND", "没有找到对应的视觉基准需求。", 404);

  const event = await startGenerationEvent(sessionId, projectId, {
    stage: "anchors",
    provider: "qwen-image",
    action: body.kind === "character" ? "生成人物候选方案" : "生成场景候选方案",
    message: `Qwen-Image 正在生成 ${body.count} 个相互独立的${body.kind === "character" ? "人物" : "场景"}候选。`,
    progressCurrent: 0,
    progressTotal: body.count
  });
  const requested = Array.from({ length: body.count }, (_, index) => ({
    id: randomUUID(),
    index: index + 1,
    prompt: body.kind === "character"
      ? buildCharacterCandidatePrompt(target as NonNullable<GenerationProject["visualAnchorWorkspace"]>["characterBriefs"][number], index + 1)
      : buildSceneCandidatePrompt(target as SceneVisualSpec, index + 1)
  }));
  try {
    const results = await Promise.all(requested.map((candidate) => callQwenImage({
      prompt: candidate.prompt,
      negativePrompt: VISUAL_ANCHOR_NEGATIVE_PROMPT,
      projectId,
      shotId: `anchor-${body.kind}-${body.targetId}-${candidate.id}`,
      sessionId,
      size: body.kind === "character" ? "1152*2048" : "2048*1152",
      watermark: false
    }).catch((error) => ({ success: false as const, assetId: null, error: error instanceof Error ? error.message : "候选生成失败。" }))));
    const successful = results.flatMap((result, index) => {
      if (!result.success || !result.assetId) return [];
      return [{ requestItem: requested[index]!, result }];
    });
    if (successful.length === 0) {
      const firstFailure = results.find((result) => result.error);
      await failGenerationEvent(sessionId, projectId, event.id, "本次候选均未生成成功，已有候选保持不变。", "PROVIDER_REQUEST_FAILED");
      return failure("VISUAL_ANCHOR_GENERATION_FAILED", firstFailure?.error ?? "候选生成失败。", 502);
    }
    const now = new Date().toISOString();
    const nextVersion = Math.max(0, ...(project.visualAnchorWorkspace![body.kind === "character" ? "characterCandidates" : "sceneCandidates"]
      .filter((candidate) => candidate.targetId === body.targetId)
      .map((candidate) => candidate.version))) + 1;
    const candidates: VisualAnchorCandidate[] = successful.map(({ requestItem, result }, index) => ({
      id: requestItem.id,
      kind: body.kind,
      targetId: body.targetId,
      assetId: result.assetId!,
      label: `${body.kind === "character" ? "人物" : "场景"}方案 ${index + 1}`,
      prompt: requestItem.prompt,
      status: "ready",
      recommended: index === 0,
      version: nextVersion,
      createdAt: now
    }));
    await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => replaceVisualAnchorCandidates(latest, body.kind, body.targetId, candidates, now));
    const failedCount = body.count - candidates.length;
    await completeGenerationEvent(sessionId, projectId, event.id, failedCount
      ? `已保留 ${candidates.length} 个成功候选，另有 ${failedCount} 个生成失败，可单独重试本模块。`
      : `${body.count} 个独立候选已生成，等待选择。`, {
      status: failedCount ? "needs-review" : "completed",
      progressCurrent: candidates.length,
      progressTotal: body.count
    });
    const final = await requireOwnedAnonymousProject(sessionId, projectId);
    return NextResponse.json({ success: true, data: publicAnonymousProject(final) });
  } catch (error) {
    await failGenerationEvent(sessionId, projectId, event.id, "视觉候选生成失败。", "PROVIDER_REQUEST_FAILED").catch(() => undefined);
    throw error;
  }
}

async function setCurrentCandidate(
  sessionId: string,
  projectId: string,
  source: GenerationProject,
  body: Extract<z.infer<typeof requestSchema>, { action: "set-current" }>,
  expectedVersion: number
) {
  const normalized = ensureVisualAnchorWorkspace(source);
  const currentSpec = body.kind === "character"
    ? normalized.characterVisualSpecs?.find((item) => item.id === body.targetId)
    : normalized.sceneVisualSpecs?.find((item) => item.id === body.targetId);
  const resourceId = getVisualAnchorResourceId(body.kind, body.targetId);
  const resourceType = `${body.kind}-master` as VersionedResourceType;
  const candidate = normalized.visualAnchorWorkspace![body.kind === "character" ? "characterCandidates" : "sceneCandidates"]
    .find((item) => item.id === body.candidateId && item.targetId === body.targetId);
  if (!candidate) throw new Error("VISUAL_ANCHOR_CANDIDATE_NOT_FOUND");
  const changingLockedMaster = Boolean(currentSpec?.locked && currentMasterAssetId(currentSpec) !== candidate.assetId);
  if (changingLockedMaster && !body.createVersion) {
    const current = currentResourceVersion(normalized.resourceVersions ?? [], resourceId);
    const impact = current ? createResourceVersionInProject(normalized, {
      resourceId,
      resourceType,
      stageId: "anchors"
    }).impact : undefined;
    throw new StageGateError("LOCKED_RESOURCE_VERSION_REQUIRED", `修改已锁定的${body.kind === "character" ? "人物" : "场景"}基准必须创建新版本。`, impact);
  }
  return mutateOwnedAnonymousProject(sessionId, projectId, (latest) => {
    let next = selectVisualAnchorCandidate(latest, body.kind, body.targetId, body.candidateId);
    const current = currentResourceVersion(next.resourceVersions ?? [], resourceId);
    if (!current || changingLockedMaster) {
      const created = createResourceVersionInProject(next, {
        resourceId,
        resourceType,
        stageId: "anchors",
        label: `${body.kind === "character" ? "Character" : "Scene"} Master ${current ? `V${current.version + 1}` : "V1"}`,
        snapshot: masterSnapshot(next, body.kind, body.targetId)
      });
      next = setSpecVersion(created.project, body.kind, body.targetId, created.version.version);
    } else {
      next = replaceCurrentResourceSnapshot(next, resourceId, masterSnapshot(next, body.kind, body.targetId));
    }
    return ensureVisualAnchorWorkspace(next);
  }, expectedVersion).then(async (saved) => {
    await startGenerationEvent(sessionId, projectId, {
      stage: "anchors",
      provider: "system",
      action: changingLockedMaster ? "Version Change" : "Set Current",
      message: changingLockedMaster ? `${resourceId} 已创建新版本；旧依赖保留并标记 outdated。` : `${resourceId} 已设为 Current，等待用户锁定。`
    });
    return requireOwnedAnonymousProject(sessionId, projectId);
  });
}

async function lockMaster(
  sessionId: string,
  projectId: string,
  source: GenerationProject,
  body: Extract<z.infer<typeof requestSchema>, { action: "lock-master" }>,
  expectedVersion: number
) {
  const resourceId = getVisualAnchorResourceId(body.kind, body.targetId);
  const resourceType = body.kind === "product" ? "product-master" : `${body.kind}-master` as VersionedResourceType;
  await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => {
    let next = lockVisualAnchorMaster(latest, body.kind, body.targetId);
    const current = currentResourceVersion(next.resourceVersions ?? [], resourceId);
    if (!current) {
      const created = createResourceVersionInProject(next, {
        resourceId,
        resourceType,
        stageId: "anchors",
        label: `${body.kind === "product" ? "Product" : body.kind === "character" ? "Character" : "Scene"} Master V1`,
        snapshot: masterSnapshot(next, body.kind, body.targetId)
      });
      next = created.project;
      if (body.kind !== "product" && body.targetId) next = setSpecVersion(next, body.kind, body.targetId, created.version.version);
    } else {
      next = replaceCurrentResourceSnapshot(next, resourceId, masterSnapshot(next, body.kind, body.targetId));
    }
    return ensureVisualAnchorWorkspace(next);
  }, expectedVersion);
  await startGenerationEvent(sessionId, projectId, {
    stage: "anchors",
    provider: "system",
    action: "Anchor Lock",
    message: `${resourceId} 已由用户锁定；后续生成只能引用当前 Master。`
  });
  return requireOwnedAnonymousProject(sessionId, projectId);
}

function applyCharacterBriefs(project: GenerationProject, briefs: NonNullable<GenerationProject["visualAnchorWorkspace"]>["characterBriefs"]) {
  const byId = new Map(briefs.map((brief) => [brief.id, brief]));
  return {
    ...project,
    characterVisualSpecs: (project.characterVisualSpecs ?? []).map((spec) => {
      const brief = byId.get(spec.id);
      return brief ? {
        ...spec,
        apparentAgeRange: brief.apparentAgeRange,
        faceAppearance: brief.faceAppearance,
        role: brief.role,
        faceDescription: brief.faceAppearance,
        hairstyle: brief.hairstyle,
        hairColor: brief.hairColor,
        skinTone: brief.skinTone,
        wardrobe: [brief.wardrobe],
        accessories: brief.accessories,
        bodyBuild: brief.bodyBuild,
        immutableTraits: brief.immutableTraits,
        states: brief.states
      } : spec;
    })
  };
}

function masterSnapshot(project: GenerationProject, kind: "product" | VisualAnchorCandidateKind, targetId?: string) {
  if (kind === "product") return { productMaster: project.visualAnchorWorkspace?.productMaster, productVisualSpec: project.productVisualSpec };
  if (kind === "character") return project.characterVisualSpecs?.find((item) => item.id === targetId);
  return project.sceneVisualSpecs?.find((item) => item.id === targetId);
}

function setSpecVersion(project: GenerationProject, kind: VisualAnchorCandidateKind, targetId: string, version: number): GenerationProject {
  return kind === "character"
    ? { ...project, characterVisualSpecs: project.characterVisualSpecs?.map((item) => item.id === targetId ? { ...item, version } : item) }
    : { ...project, sceneVisualSpecs: project.sceneVisualSpecs?.map((item) => item.id === targetId ? { ...item, version } : item) };
}

function replaceCurrentResourceSnapshot(project: GenerationProject, resourceId: string, snapshot: unknown): GenerationProject {
  return {
    ...project,
    resourceVersions: project.resourceVersions?.map((item) => item.resourceId === resourceId && item.status === "current"
      ? { ...item, snapshot, createdAt: Date.now() }
      : item)
  };
}

function mapAnchorError(error: unknown) {
  const message = error instanceof Error ? error.message : "视觉基准更新失败。";
  if (/PRODUCT_REFERENCE_REQUIRED/.test(message)) return failure("PRODUCT_REFERENCE_REQUIRED", "请先上传一张真实主产品图片。", 400);
  if (/PRODUCT_VISUAL_SPEC_REQUIRED/.test(message)) return failure("PRODUCT_VISUAL_SPEC_REQUIRED", "主产品尚未完成视觉身份分析。", 400);
  if (/CHARACTER_MASTER_REQUIRED/.test(message)) return failure("CHARACTER_MASTER_REQUIRED", "请先选择人物候选，再锁定人物基准。", 400);
  if (/SCENE_MASTER_REQUIRED/.test(message)) return failure("SCENE_MASTER_REQUIRED", "请先选择场景候选，再锁定场景基准。", 400);
  if (/CANDIDATE_NOT_FOUND/.test(message)) return failure("VISUAL_ANCHOR_CANDIDATE_NOT_FOUND", "候选不存在或已过期。", 404);
  return failure("VISUAL_ANCHOR_UPDATE_FAILED", message.slice(0, 300), 500);
}

function failure(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, data: null, error: message, errorCode: code }, { status });
}
