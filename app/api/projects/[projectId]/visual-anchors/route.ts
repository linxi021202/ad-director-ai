import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { generateQwenImageAdaptive, type QwenModelAttempt } from "@/lib/image/qwenImageModelRouter";
import { qwenImageUserMessage } from "@/lib/image/qwenImageErrors";
import { assertImageStorageCapacity, StorageCapacityError } from "@/lib/assets/storageCapacity";
import { assertPrivateAssetReadable, requirePrivateAsset } from "@/lib/assets/assetStore";
import { readProductReferenceDataUrl, selectPrimaryProductImage } from "@/lib/image/productReference";
import type { QwenImageResult } from "@/lib/image/types";
import { readModelCallLogArchive, upsertModelCallLog } from "@/lib/logs/modelCallStore";
import {
  AnonymousProjectVersionConflictError,
  mutateOwnedAnonymousProject,
  requireOwnedAnonymousProject
} from "@/lib/projects/anonymousProjectStore";
import { projectNotFoundResponse, projectStoreErrorResponse, publicAnonymousProject } from "@/lib/projects/api";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent } from "@/lib/projects/generationEvents";
import { generateCharacterAnchorBriefs, generateCharacterCandidateDirections, generateSceneCandidateDirections } from "@/lib/providers/deepseekProvider";
import type {
  CharacterVisualSpec,
  CharacterCandidateDirection,
  GenerationProject,
  SceneVisualSpec,
  SceneCandidateDirection,
  VisualAnchorCandidate,
  VisualAnchorCandidateKind,
  VersionedResourceType
} from "@/lib/schemas/project";
import { getAnonymousApiSession } from "@/lib/session/api";
import { StageGateError, createResourceVersionInProject, currentResourceVersion } from "@/lib/workflow/stageGates";
import { buildCharacterCandidatePrompt, buildSceneCandidatePrompt, sceneRequiresProductReference, PRODUCT_SCENE_NEGATIVE_PROMPT, VISUAL_ANCHOR_NEGATIVE_PROMPT } from "@/lib/visual/anchorPrompts";
import { resolveProjectProductVisualSpec } from "@/lib/visual/productVisualSpec";
import { fallbackCharacterDirections, fallbackSceneDirections, inspectCandidateDiversity } from "@/lib/visual/candidateDirections";
import {
  currentMasterAssetId,
  ensureVisualAnchorWorkspace,
  getVisualAnchorReadiness,
  getVisualAnchorResourceId,
  getVisualAnchorSelection,
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
    count: z.number().int().min(1).max(3).default(3),
    candidateIndex: z.number().int().min(1).max(3).optional()
  }).strict(),
  z.object({ action: z.literal("recover-candidates"), kind: z.literal("scene"), targetId: z.string().trim().min(1).max(120),
    taskId: z.string().uuid(), expectedVersion: z.number().int().positive().optional() }).strict(),
  z.object({
    action: z.literal("set-current"),
    expectedVersion: z.number().int().positive(),
    kind: z.enum(["character", "scene"]),
    targetId: z.string().trim().min(1).max(120),
    candidateId: z.string().uuid()
  }).strict(),
  z.object({
    action: z.literal("lock-master"),
    expectedVersion: z.number().int().positive(),
    kind: z.enum(["product", "character", "scene"]),
    targetId: z.string().trim().min(1).max(120).optional(),
    createVersion: z.boolean().optional()
  }).strict(),
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
    if (!(body.action === "generate-candidates" && body.kind === "scene")
      && body.action !== "recover-candidates" && current.version !== body.expectedVersion) {
      throw new AnonymousProjectVersionConflictError();
    }

    if (body.action === "initialize") {
      return await initializeAnchors(sessionResult.session.id, projectId.data, current.project);
    }
    if (body.action === "generate-candidates") {
      return await generateCandidates(sessionResult.session.id, projectId.data, current.project, current.version, body);
    }
    if (body.action === "recover-candidates") {
      return await recoverSceneCandidates(sessionResult.session.id, projectId.data, body.targetId, body.taskId);
    }
    if (body.action === "set-current") {
      const saved = await setCurrentCandidate(sessionResult.session.id, projectId.data, current.project, body, current.version);
      return NextResponse.json({ success: true, data: publicAnonymousProject(saved) });
    }
    const saved = await lockMaster(sessionResult.session.id, projectId.data, current.project, body, current.version);
    return NextResponse.json({ success: true, data: publicAnonymousProject(saved) });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? mapAnchorError(error);
  }
}

async function initializeAnchors(sessionId: string, projectId: string, source: GenerationProject) {
  const event = await startGenerationEvent(sessionId, projectId, {
    stage: "anchors",
    provider: "deepseek",
    action: "整理视觉需求",
    message: "DeepSeek 正在根据已锁定创意整理人物需求与场景身份。"
  });
  try {
    const project = ensureVisualAnchorWorkspace(source);
    const productSpec = await resolveProjectProductVisualSpec({ sessionId, project }).catch((error) => ({
      spec: null,
      error: error instanceof Error ? error.message : "产品图片分析暂时不可用。"
    }));
    const defaults = project.visualAnchorWorkspace!.characterBriefs;
    const generated = await generateCharacterAnchorBriefs(project.brief, project.creativeBible!, defaults, {
      sessionId,
      maxProviderAttempts: 1
    });
    await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => {
      let next = ensureVisualAnchorWorkspace(latest);
      if (productSpec.spec && !next.productVisualSpec) next = { ...next, productVisualSpec: productSpec.spec };
      const briefsUnchanged = JSON.stringify(next.visualAnchorWorkspace?.characterBriefs) === JSON.stringify(defaults);
      if (generated.success && generated.data && briefsUnchanged) {
        next = applyCharacterBriefs({ ...next, visualAnchorWorkspace: {
          ...next.visualAnchorWorkspace!, characterBriefs: generated.data
        } }, generated.data);
      }
      return ensureVisualAnchorWorkspace(next);
    });
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
  projectVersionAtStart: number,
  body: Extract<z.infer<typeof requestSchema>, { action: "generate-candidates" }>
) {
  if (body.candidateIndex && body.count !== 1) return failure("VISUAL_ANCHOR_INVALID_CANDIDATE", "补生成单个候选时数量必须为 1。", 400);
  const project = ensureVisualAnchorWorkspace(source);
  const target = body.kind === "character"
    ? project.visualAnchorWorkspace!.characterBriefs.find((item) => item.id === body.targetId)
    : project.sceneVisualSpecs?.find((item) => item.id === body.targetId);
  if (!target) return failure("VISUAL_ANCHOR_TARGET_NOT_FOUND", "没有找到对应的视觉基准需求。", 404);
  try { await assertImageStorageCapacity(body.count); }
  catch (error) {
    if (!(error instanceof StorageCapacityError)) throw error;
    return failure(error.code, error.message, 507);
  }
  const needsProductReference = body.kind === "scene" && sceneRequiresProductReference(target as SceneVisualSpec, project.brief.productName);

  const event = await startGenerationEvent(sessionId, projectId, {
    stage: "anchors",
    provider: "qwen-image",
    action: body.kind === "character" ? "生成人物候选方案" : "生成场景候选方案",
    message: `Qwen-Image 正在生成 ${body.count} 个相互独立的${body.kind === "character" ? "人物" : "场景"}候选。`,
    progressCurrent: 0,
    progressTotal: body.count
  });
  const setId = randomUUID();
  const indexes = body.candidateIndex ? [body.candidateIndex] : Array.from({ length: body.count }, (_, index) => index + 1);
  const candidateIds = new Map(indexes.map((index) => [index, randomUUID()]));
  let candidatesStarted = false;
  let persistenceStarted = false;
  try {
    const planned = body.kind === "character"
      ? await generateCharacterCandidateDirections(target as NonNullable<GenerationProject["visualAnchorWorkspace"]>["characterBriefs"][number], { sessionId, maxProviderAttempts: 1 })
      : await generateSceneCandidateDirections(target as SceneVisualSpec, { sessionId, maxProviderAttempts: 1 });
    const directions = planned.success && planned.data ? planned.data : body.kind === "character"
      ? fallbackCharacterDirections(target as NonNullable<GenerationProject["visualAnchorWorkspace"]>["characterBriefs"][number])
      : fallbackSceneDirections(target as SceneVisualSpec);
    let productReference: Promise<string | undefined> | undefined;
    const requested = indexes.map((index) => ({ id: candidateIds.get(index)!, index, direction: directions[index - 1] }));
    const runCandidate = async (candidate: (typeof requested)[number], repair = false, repairPrompt?: string) => {
      const startedAt = Date.now();
      let prompt: string;
      try {
        if (!candidate.direction) throw new Error(`候选 ${candidate.index} 缺少创意方向。`);
        prompt = repairPrompt ?? (body.kind === "character"
          ? buildCharacterCandidatePrompt(target as NonNullable<GenerationProject["visualAnchorWorkspace"]>["characterBriefs"][number], candidate.direction as CharacterCandidateDirection)
          : buildSceneCandidatePrompt(target as SceneVisualSpec, candidate.direction as SceneCandidateDirection,
            needsProductReference ? project.brief.productName : undefined));
      } catch (error) {
        await logAnchorCandidateFailure(sessionId, projectId, event, body.kind, body.targetId, candidate.id, candidate.index, "PROMPT_BUILD_FAILED", error, startedAt, repair, needsProductReference);
        return { requestItem: { ...candidate, prompt: "" }, result: null };
      }
      const requestItem = { ...candidate, prompt };
      let referenceImage: string | undefined;
      try {
        referenceImage = needsProductReference
          ? await (productReference ??= readProductReferenceDataUrl(selectPrimaryProductImage(project.brief.productImages), { sessionId, projectId }))
          : undefined;
        if (needsProductReference && !referenceImage) throw new Error("场景需要真实商品参考图，但主产品图未保存。");
      } catch (error) {
        await logAnchorCandidateFailure(sessionId, projectId, event, body.kind, body.targetId, candidate.id, candidate.index,
          "REFERENCE_ASSET_LOAD_FAILED", error, startedAt, repair, needsProductReference);
        return { requestItem, result: null };
      }
      let modelAttemptSeen = false;
      try {
        const result = await generateQwenImageAdaptive({
          taskType: body.kind === "character" ? "character_candidate" : needsProductReference ? "scene_candidate_with_product_reference" : "scene_candidate_text_only",
          requiredCapabilities: { textToImage: !needsProductReference, referenceImageInput: needsProductReference, highConsistency: needsProductReference },
          prompt, ...(referenceImage ? { referenceImages: [referenceImage] } : {}),
          negativePrompt: needsProductReference ? PRODUCT_SCENE_NEGATIVE_PROMPT : VISUAL_ANCHOR_NEGATIVE_PROMPT,
          projectId,
          shotId: `anchor-${body.kind}-${body.targetId}-${candidate.id}${repair ? "-repair" : ""}`,
          sessionId, size: body.kind === "character" ? "1152*2048" : "2048*1152", watermark: false
        }, (attempt) => {
          modelAttemptSeen = true;
          return logAnchorModelAttempt(sessionId, projectId, event, body.kind, body.targetId, candidate.id, candidate.index, attempt, repair);
        });
        if (!modelAttemptSeen) await logAnchorCandidateResult(sessionId, projectId, event, body.kind, body.targetId, candidate.id, candidate.index, result, startedAt, repair, needsProductReference);
        return { requestItem, result };
      } catch (error) {
        const phase = error instanceof Error && error.message === "SUBMISSION_STATE_UNKNOWN" ? "MODEL_SUBMISSION_FAILED"
          : modelAttemptSeen ? "UNKNOWN" : "MODEL_ROUTING_FAILED";
        await logAnchorCandidateFailure(sessionId, projectId, event, body.kind, body.targetId, candidate.id, candidate.index, phase, error, startedAt, repair, needsProductReference);
        return { requestItem, result: null };
      }
    };
    candidatesStarted = true;
    const results = [] as Awaited<ReturnType<typeof runCandidate>>[];
    let providerHardStop: "ACCOUNT_ARREARAGE" | "ACCOUNT_AUTH_FAILED" | null = null;
    for (const candidate of requested) {
      if (providerHardStop) {
        await logAnchorCandidateBlocked(sessionId, projectId, event, body.kind, body.targetId, candidate.id, candidate.index, providerHardStop, needsProductReference);
        results.push({ requestItem: { ...candidate, prompt: "" }, result: null });
        continue;
      }
      const completed = await runCandidate(candidate);
      results.push(completed);
      if (completed.result?.errorCode === "INSUFFICIENT_BALANCE") providerHardStop = "ACCOUNT_ARREARAGE";
      else if (completed.result?.errorCode === "AUTH_FAILED") providerHardStop = "ACCOUNT_AUTH_FAILED";
    }
    const initialAssetIds = results.flatMap(({ result }) => result?.success && result.assetId ? [result.assetId] : []);
    const diversity = await inspectCandidateDiversity({ kind: body.kind, assetIds: initialAssetIds, sessionId, projectId });
    if (!diversity.passed && initialAssetIds.length === body.count) {
      const repairIndexes = new Set(diversity.tooSimilarIndexes.slice(0, 2));
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index]!;
        if (!repairIndexes.has(index + 1) || providerHardStop) continue;
        const candidate = requested[index]!;
        const repaired = await runCandidate(candidate,
          true, `${result.requestItem.prompt}\n多样性修复：上一版与其他方案过于相似。必须强化本方向的独有脸型/空间拓扑、轮廓、材质和构图差异，同时保持角色或场景功能不变。`);
        if (repaired.result?.errorCode === "INSUFFICIENT_BALANCE") providerHardStop = "ACCOUNT_ARREARAGE";
        else if (repaired.result?.errorCode === "AUTH_FAILED") providerHardStop = "ACCOUNT_AUTH_FAILED";
        if (repaired.result?.success && repaired.result.assetId) results[index] = { ...result, result: repaired.result };
      }
    }
    const successful = results.filter((item): item is { requestItem: (typeof results)[number]["requestItem"]; result: QwenImageResult } => Boolean(item.result?.success && item.result.assetId));
    if (successful.length === 0) {
      const firstCode = results.find((item) => item.result?.errorCode)?.result?.errorCode;
      const guidance = results.every((item) => !item.result) && needsProductReference
        ? "真实商品参考图无法读取，请重新上传主产品图后重试。" : qwenImageUserMessage(firstCode);
      await failGenerationEvent(sessionId, projectId, event.id, `已有候选保持不变。${guidance}`, firstCode ?? "PROVIDER_REQUEST_FAILED");
      return failure("VISUAL_ANCHOR_GENERATION_FAILED", guidance, 502);
    }
    const now = new Date().toISOString();
    const buildVersion = await requireOwnedAnonymousProject(sessionId, projectId);
    await logAnchorPersistPhase(sessionId, projectId, event, body.kind === "scene" ? "scene-candidates-building" : "character-candidates-building",
      "started", projectVersionAtStart, buildVersion.version, undefined, 1);
    const candidates: VisualAnchorCandidate[] = successful.map(({ requestItem, result }, index) => ({
      id: requestItem.id,
      kind: body.kind,
      candidateIndex: requestItem.index,
      targetId: body.targetId,
      assetId: result.assetId!,
      label: `${body.kind === "character" ? "人物" : "场景"}方案 ${requestItem.index}`,
      prompt: requestItem.prompt,
      directionTitle: requestItem.direction.title,
      directionSummary: requestItem.direction.differentiation,
      setId,
      status: "ready",
      recommended: index === 0,
      version: 1,
      createdAt: now
    }));
    persistenceStarted = true;
    const beforePersist = await requireOwnedAnonymousProject(sessionId, projectId);
    await logAnchorPersistPhase(sessionId, projectId, event, body.kind === "scene" ? "scene-candidates-built" : "character-candidates-built",
      "completed", projectVersionAtStart, beforePersist.version, undefined, 1);
    let saved: Awaited<ReturnType<typeof mutateOwnedAnonymousProject>> | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const before = await requireOwnedAnonymousProject(sessionId, projectId);
      await logAnchorPersistPhase(sessionId, projectId, event, attempt === 1 ? "project-patch-started" : "project-patch-retrying", "started",
        projectVersionAtStart, before.version, undefined, attempt);
      try {
        saved = await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => {
          if (!latest.sceneVisualSpecs?.some((spec) => spec.id === body.targetId) && body.kind === "scene") {
            throw new Error("VISUAL_ANCHOR_TARGET_NOT_FOUND");
          }
          const workspace = ensureVisualAnchorWorkspace(latest).visualAnchorWorkspace!;
          const existing = workspace[body.kind === "character" ? "characterCandidates" : "sceneCandidates"];
          const nextVersion = Math.max(0, ...existing.filter((candidate) => candidate.targetId === body.targetId).map((candidate) => candidate.version)) + 1;
          const versioned = candidates.map((candidate) => ({ ...candidate, setVersion: nextVersion, version: nextVersion }));
          return replaceVisualAnchorCandidates(latest, body.kind, body.targetId, versioned, now,
            successful.length < body.count || Boolean(body.candidateIndex));
        });
        await logAnchorPersistPhase(sessionId, projectId, event, "project-patch-completed", "completed",
          projectVersionAtStart, before.version, saved.version, attempt);
        break;
      } catch (error) {
        if (!(error instanceof AnonymousProjectVersionConflictError) || attempt === 2) throw error;
        await logAnchorPersistPhase(sessionId, projectId, event, "project-version-conflict", "conflict",
          projectVersionAtStart, before.version, (await requireOwnedAnonymousProject(sessionId, projectId)).version, attempt);
        await logAnchorPersistPhase(sessionId, projectId, event, "project-reloaded", "completed",
          projectVersionAtStart, (await requireOwnedAnonymousProject(sessionId, projectId)).version, undefined, attempt);
      }
    }
    if (!saved) throw new Error("PROJECT_PERSIST_FAILED");
    const persisted = await requireOwnedAnonymousProject(sessionId, projectId);
    const stored = persisted.project.visualAnchorWorkspace?.[body.kind === "character" ? "characterCandidates" : "sceneCandidates"] ?? [];
    if (!candidates.every((candidate) => stored.some((item) => item.id === candidate.id && item.assetId === candidate.assetId && item.status !== "outdated"))) {
      throw new Error("PROJECT_PERSIST_FAILED: 候选写入后校验失败");
    }
    await logAnchorPersistPhase(sessionId, projectId, event, "project-read-after-write-verified", "verified",
      projectVersionAtStart, beforePersist.version, persisted.version, 1);
    const failedCount = body.count - candidates.length;
    await completeGenerationEvent(sessionId, projectId, event.id, failedCount
      ? `已保留 ${candidates.length} 个成功候选，另有 ${failedCount} 个生成失败，可单独重试本模块。`
      : `${body.count} 个独立候选已生成，等待选择。`, {
      status: failedCount ? "needs-review" : "completed",
      progressCurrent: candidates.length,
      progressTotal: body.count
    });
    const final = await requireOwnedAnonymousProject(sessionId, projectId);
    await logAnchorPersistPhase(sessionId, projectId, event, "task-completed", "completed",
      projectVersionAtStart, beforePersist.version, final.version, 1);
    return NextResponse.json({ success: true, data: publicAnonymousProject(final) });
  } catch (error) {
    if (!candidatesStarted) await Promise.all(indexes.map((index) => logAnchorCandidateFailure(sessionId, projectId, event, body.kind,
      body.targetId, candidateIds.get(index)!, index, "PROMPT_BUILD_FAILED", error, event.startedAt, false, needsProductReference).catch(() => undefined)));
    if (persistenceStarted) {
      const actualVersion = await requireOwnedAnonymousProject(sessionId, projectId).then((record) => record.version).catch(() => undefined);
      await logAnchorPersistPhase(sessionId, projectId, event, "project-patch-failed", "failed",
        projectVersionAtStart, actualVersion, undefined, 1).catch(() => undefined);
    }
    await failGenerationEvent(sessionId, projectId, event.id,
      persistenceStarted ? "候选图片已生成，但项目保存或核验失败；可从调用记录恢复，勿重新生成。" : "视觉候选生成失败。",
      persistenceStarted ? error instanceof AnonymousProjectVersionConflictError ? "VERSION_CONFLICT" : "PROJECT_PERSIST_FAILED" : "PROVIDER_REQUEST_FAILED").catch(() => undefined);
    throw error;
  }
}

async function recoverSceneCandidates(sessionId: string, projectId: string, targetId: string, taskId: string) {
  const current = await requireOwnedAnonymousProject(sessionId, projectId);
  const workspace = ensureVisualAnchorWorkspace(current.project).visualAnchorWorkspace!;
  if (!current.project.sceneVisualSpecs?.some((spec) => spec.id === targetId) || !workspace.requiredSceneIds.includes(targetId)) {
    return failure("VISUAL_ANCHOR_TARGET_NOT_FOUND", "场景需求已变化，无法自动挂接旧图片。", 409);
  }
  const event = current.project.generationEvents?.find((item) => item.id === taskId && item.stage === "anchors"
    && item.provider === "qwen-image" && item.action === "生成场景候选方案" && !["queued", "running", "qa-review"].includes(item.status));
  if (!event) return failure("VISUAL_ANCHOR_RECOVERY_NOT_FOUND", "未找到已结束的场景生成任务。", 404);
  const archive = await readModelCallLogArchive(sessionId, projectId, taskId);
  const calls = archive.entries.filter((item) => item.kind === "call" && item.anchorType === "scene" && item.status === "completed"
    && item.candidateId && item.candidateIndex && item.finalAssetId);
  if (!calls.length || calls.some((item) => item.anchorTargetId && item.anchorTargetId !== targetId)
    || calls.some((item) => !item.anchorTargetId) && workspace.requiredSceneIds.length !== 1) {
    return failure("VISUAL_ANCHOR_RECOVERY_AMBIGUOUS", "无法确认旧任务对应的场景，请保留调用日志并联系维护人员。", 409);
  }
  const byIndex = new Map<number, (typeof calls)[number]>();
  for (const call of calls) {
    const previous = byIndex.get(call.candidateIndex!);
    if (!previous || (call.completedAt ?? 0) > (previous.completedAt ?? 0)) byIndex.set(call.candidateIndex!, call);
  }
  const recovered = [...byIndex.values()].sort((a, b) => a.candidateIndex! - b.candidateIndex!);
  const occupiedIndexes = new Set(workspace.sceneCandidates.filter((item) => item.targetId === targetId && item.status !== "outdated")
    .map((item) => item.candidateIndex));
  const toRestore = recovered.filter((call) => !occupiedIndexes.has(call.candidateIndex));
  if (!toRestore.length) {
    return NextResponse.json({ success: true, data: publicAnonymousProject(current), recovered: 0 }, {
      headers: { "cache-control": "no-store" }
    });
  }
  for (const call of toRestore) {
    try {
      const asset = await requirePrivateAsset(sessionId, projectId, call.finalAssetId!);
      if (!asset.mimeType.startsWith("image/")) throw new Error("ASSET_NOT_IMAGE");
      await assertPrivateAssetReadable(asset);
    } catch {
      return failure("VISUAL_ANCHOR_RECOVERY_ASSET_MISSING", `场景候选 ${call.candidateIndex} 的图片文件不可读取，未修改项目。`, 410);
    }
  }
  const now = new Date().toISOString();
  const before = await requireOwnedAnonymousProject(sessionId, projectId);
  await logAnchorPersistPhase(sessionId, projectId, event, "project-reloaded", "completed", before.version, before.version, undefined, 1);
  const saved = await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => {
    const normalized = ensureVisualAnchorWorkspace(latest);
    const visual = normalized.visualAnchorWorkspace!;
    const existingIds = new Set(visual.sceneCandidates.map((item) => item.id));
    const existingAssets = new Set(visual.sceneCandidates.filter((item) => item.targetId === targetId && item.status !== "outdated")
      .map((item) => item.assetId));
    const version = Math.max(0, ...visual.sceneCandidates.filter((item) => item.targetId === targetId).map((item) => item.version)) + 1;
    const activeIndexes = new Set(visual.sceneCandidates.filter((item) => item.targetId === targetId && item.status !== "outdated")
      .map((item) => item.candidateIndex));
    const additions: VisualAnchorCandidate[] = toRestore.filter((call) => !activeIndexes.has(call.candidateIndex)
      && !existingIds.has(call.candidateId!) && !existingAssets.has(call.finalAssetId!))
      .map((call, index) => ({ id: call.candidateId!, kind: "scene", candidateIndex: call.candidateIndex!, targetId,
        assetId: call.finalAssetId!, label: `场景方案 ${call.candidateIndex}`, prompt: "从已完成任务恢复的场景图片；原始生成提示词未记录。",
        setId: event.runId, setVersion: version, status: "ready", recommended: index === 0,
        version, createdAt: new Date(call.completedAt ?? event.startedAt).toISOString() }));
    if (!additions.length) return latest;
    return ensureVisualAnchorWorkspace({ ...normalized, visualAnchorWorkspace: {
      ...visual, sceneCandidates: [...visual.sceneCandidates, ...additions], updatedAt: now
    } }, now);
  });
  const verified = await requireOwnedAnonymousProject(sessionId, projectId);
  const stored = verified.project.visualAnchorWorkspace?.sceneCandidates ?? [];
  if (!toRestore.every((call) => stored.some((item) => item.targetId === targetId
    && item.candidateIndex === call.candidateIndex && item.status !== "outdated"))) {
    return failure("PROJECT_PERSIST_FAILED", "场景图片恢复后的项目核验失败，请稍后重试。", 500);
  }
  await logAnchorPersistPhase(sessionId, projectId, event, "project-read-after-write-verified", "verified",
    before.version, before.version, saved.version, 1);
  if (event.status === "failed" || event.status === "interrupted") {
    await completeGenerationEvent(sessionId, projectId, event.id, "已从原任务保存的图片恢复场景候选；没有重新调用模型。",
      { progressCurrent: recovered.length, progressTotal: recovered.length });
  }
  const final = await requireOwnedAnonymousProject(sessionId, projectId);
  const recoveredCount = toRestore.filter((call) => stored.some((item) => item.id === call.candidateId && item.assetId === call.finalAssetId)).length;
  return NextResponse.json({ success: true, data: publicAnonymousProject(final), recovered: recoveredCount }, {
    headers: { "cache-control": "no-store" }
  });
}

async function logAnchorPersistPhase(sessionId: string, projectId: string,
  event: Pick<Awaited<ReturnType<typeof startGenerationEvent>>, "id" | "runId" | "startedAt">,
  mode: string, persistStatus: "started" | "conflict" | "completed" | "failed" | "verified",
  projectVersionAtStart: number, projectVersionBeforePersist?: number, projectVersionAfterPersist?: number, persistAttempt = 1) {
  await upsertModelCallLog(sessionId, {
    id: anchorAttemptId(event.id, event.runId, `${mode}:${persistAttempt}`), kind: "call", taskId: event.id,
    jobId: event.runId, projectId, stage: "anchors", provider: "system", mode,
    status: persistStatus === "started" ? "running" : persistStatus === "failed" || persistStatus === "conflict" ? "failed" : "completed",
    startedAt: Date.now(), completedAt: Date.now(), durationMs: 0, persistStatus, persistAttempt,
    projectVersionAtStart, projectVersionBeforePersist, projectVersionAfterPersist,
    projectVersionBefore: projectVersionBeforePersist, projectVersionActual: projectVersionAfterPersist,
    failurePhase: persistStatus === "failed" ? "PROJECT_PERSIST_FAILED" : persistStatus === "conflict" ? "VERSION_CONFLICT" : undefined,
    errorCode: persistStatus === "failed" ? "PROJECT_PERSIST_FAILED" : persistStatus === "conflict" ? "VERSION_CONFLICT" : undefined
  }).catch(() => undefined);
}

type AnchorFailurePhase = "PROMPT_BUILD_FAILED" | "REFERENCE_ASSET_LOAD_FAILED" | "REFERENCE_URL_BUILD_FAILED"
  | "MODEL_ROUTING_FAILED" | "MODEL_REQUEST_FAILED" | "MODEL_SUBMISSION_FAILED"
  | "MODEL_GENERATION_FAILED" | "OUTPUT_PARSE_FAILED" | "ASSET_DOWNLOAD_FAILED"
  | "ASSET_PERSIST_FAILED" | "UNKNOWN";

function anchorFailurePhase(result: QwenImageResult): AnchorFailurePhase | undefined {
  if (result.success && result.assetId) return undefined;
  if (result.errorCode === "ASSET_DOWNLOAD_FAILED") return "ASSET_DOWNLOAD_FAILED";
  if (result.errorCode === "STORAGE_CAPACITY_LOW" || result.errorCode === "STORAGE_UNAVAILABLE") return "ASSET_PERSIST_FAILED";
  if (result.errorCode === "ASSET_PERSIST_FAILED" || (result.success && !result.assetId)) return "ASSET_PERSIST_FAILED";
  if (result.errorCode === "SUBMISSION_STATE_UNKNOWN") return "MODEL_SUBMISSION_FAILED";
  if (result.errorCode === "TASK_POLL_INTERRUPTED") return "MODEL_GENERATION_FAILED";
  if (result.networkFailure?.failurePhase === "JSON_PARSE") return "OUTPUT_PARSE_FAILED";
  if (result.taskId) return "MODEL_GENERATION_FAILED";
  if (result.errorCode === "PROVIDER_NOT_CONFIGURED" || result.errorCode === "MODEL_NOT_AVAILABLE") return "MODEL_ROUTING_FAILED";
  return result.httpStatus || result.requestStartedAt ? "MODEL_REQUEST_FAILED" : "MODEL_ROUTING_FAILED";
}

async function logAnchorModelAttempt(sessionId: string, projectId: string, event: Awaited<ReturnType<typeof startGenerationEvent>>,
  anchorType: VisualAnchorCandidateKind, anchorTargetId: string, candidateId: string, candidateIndex: number, attempt: QwenModelAttempt, repair: boolean) {
  const logId = anchorAttemptId(event.id, candidateId, `${repair ? "repair" : "initial"}:${attempt.model}:${attempt.attempt}`);
  await upsertModelCallLog(sessionId, {
    id: logId, kind: "call", taskId: event.id, jobId: event.runId, projectId, stage: "anchors", provider: "qwen-image",
    taskType: attempt.taskType, anchorType, anchorTargetId, candidateId, candidateIndex, model: attempt.model, attempt: attempt.attempt, mode: attempt.mode,
    status: attempt.status, startedAt: attempt.startedAt, completedAt: attempt.completedAt,
    requestStartedAt: attempt.status === "blocked" ? undefined : attempt.submissionDiagnostic?.requestStartedAt ?? attempt.startedAt,
    requestCompletedAt: attempt.status === "blocked" ? undefined : attempt.completedAt,
    durationMs: Math.max(0, attempt.completedAt - attempt.startedAt),
    referenceImageCount: attempt.referenceCount, referenceImagesIncluded: attempt.referenceCount > 0,
    errorCode: attempt.errorCode, providerErrorCode: attempt.providerErrorCode, errorSummary: attempt.error,
    routerDecision: attempt.routerDecision, routerResult: attempt.routerResult, selectedModel: attempt.selectedModel,
    httpStatus: attempt.httpStatus, providerRequestId: attempt.requestId, providerTaskId: attempt.taskId,
    finalAssetId: attempt.assetId, ...(attempt.assetId ? { outputAssetIds: [attempt.assetId] } : {}),
    failurePhase: attempt.status === "failed" ? anchorFailurePhase({ success: false, provider: "dashscope", model: attempt.model,
      latencyMs: 0, size: attempt.size, errorCode: attempt.errorCode, httpStatus: attempt.httpStatus,
      taskId: attempt.taskId, networkFailure: attempt.networkFailure,
      requestStartedAt: attempt.submissionDiagnostic?.requestStartedAt }) : undefined,
    errorName: attempt.networkFailure?.errorName, causeCode: attempt.networkFailure?.causeCode,
    requestHost: attempt.submissionDiagnostic?.requestHost, requestPath: attempt.submissionDiagnostic?.requestPath,
    region: attempt.submissionDiagnostic?.region, workspaceIdMasked: attempt.submissionDiagnostic?.workspaceIdMasked,
    apiMode: attempt.submissionDiagnostic?.apiMode, payloadBytes: attempt.submissionDiagnostic?.payloadBytes,
    submissionTimeoutMs: attempt.submissionDiagnostic?.timeoutMs,
    referenceSourceTypes: attempt.submissionDiagnostic?.referenceTypes,
    networkErrorName: attempt.networkFailure?.errorName, networkErrorMessage: attempt.networkFailure?.errorMessage,
    networkCauseCode: attempt.networkFailure?.causeCode, networkCauseErrno: attempt.networkFailure?.causeErrno,
    networkCauseSyscall: attempt.networkFailure?.causeSyscall,
    requestOptions: { size: attempt.size, referenceCount: attempt.referenceCount,
      endpointMode: attempt.model === "qwen-image-3.0" ? "dashscope-async" : "dashscope-sync",
      promptExtend: attempt.promptExtend, watermark: attempt.watermark }
  });
}

async function logAnchorCandidateResult(sessionId: string, projectId: string, event: Awaited<ReturnType<typeof startGenerationEvent>>,
  anchorType: VisualAnchorCandidateKind, anchorTargetId: string, candidateId: string, candidateIndex: number, result: QwenImageResult,
  startedAt: number, repair: boolean, productReference = false) {
  await upsertModelCallLog(sessionId, {
    id: anchorAttemptId(event.id, candidateId, repair ? "repair:summary" : "initial:summary"),
    kind: "call", taskId: event.id, jobId: event.runId, projectId, stage: "anchors", provider: "qwen-image",
    taskType: anchorType === "character" ? "character_candidate" : productReference ? "scene_candidate_with_product_reference" : "scene_candidate_text_only",
    anchorType, anchorTargetId, candidateId, candidateIndex, model: result.model, attempt: 1, mode: "anchor-candidate",
    status: result.success && result.assetId ? "completed" : "failed", startedAt,
    completedAt: Date.now(), durationMs: Date.now() - startedAt,
    requestStartedAt: result.requestStartedAt, requestCompletedAt: result.requestCompletedAt,
    referenceImageCount: result.referenceUsed ? 1 : 0, referenceImagesIncluded: Boolean(result.referenceUsed),
    errorCode: result.errorCode, providerErrorCode: result.providerErrorCode, errorSummary: result.error,
    httpStatus: result.httpStatus, providerRequestId: result.requestId, providerTaskId: result.taskId,
    finalAssetId: result.assetId, ...(result.assetId ? { outputAssetIds: [result.assetId] } : {}),
    failurePhase: anchorFailurePhase(result), errorName: result.networkFailure?.errorName,
    causeCode: result.networkFailure?.causeCode
  });
}

async function logAnchorCandidateBlocked(sessionId: string, projectId: string, event: Awaited<ReturnType<typeof startGenerationEvent>>,
  anchorType: VisualAnchorCandidateKind, anchorTargetId: string, candidateId: string, candidateIndex: number,
  blockedBy: "ACCOUNT_ARREARAGE" | "ACCOUNT_AUTH_FAILED", productReference: boolean) {
  const now = Date.now();
  await upsertModelCallLog(sessionId, {
    id: anchorAttemptId(event.id, candidateId, "initial:account-blocked"),
    kind: "call", taskId: event.id, jobId: event.runId, projectId, stage: "anchors", provider: "qwen-image",
    taskType: anchorType === "character" ? "character_candidate" : productReference ? "scene_candidate_with_product_reference" : "scene_candidate_text_only",
    anchorType, anchorTargetId, candidateId, candidateIndex, model: "未调用", attempt: 1, mode: "anchor-candidate",
    status: "blocked", startedAt: now, completedAt: now, durationMs: 0,
    referenceImageCount: 0, referenceImagesIncluded: false, blockedBy, errorCode: "BLOCKED_ACCOUNT_ERROR",
    routerDecision: "STOP_PROVIDER", routerResult: blockedBy, errorSummary: "账户不可用，当前候选未向百炼发送请求。"
  });
}

async function logAnchorCandidateFailure(sessionId: string, projectId: string, event: Awaited<ReturnType<typeof startGenerationEvent>>,
  anchorType: VisualAnchorCandidateKind, anchorTargetId: string, candidateId: string, candidateIndex: number, failurePhase: AnchorFailurePhase,
  error: unknown, startedAt: number, repair = false, productReference = false) {
  const cause = error instanceof Error && "cause" in error && error.cause && typeof error.cause === "object"
    ? error.cause as { code?: unknown } : undefined;
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : failurePhase;
  await upsertModelCallLog(sessionId, {
    id: anchorAttemptId(event.id, candidateId, repair ? "repair:exception" : "initial:exception"),
    kind: "call", taskId: event.id, jobId: event.runId, projectId, stage: "anchors", provider: "qwen-image",
    taskType: anchorType === "character" ? "character_candidate" : productReference ? "scene_candidate_with_product_reference" : "scene_candidate_text_only",
    anchorType, anchorTargetId, candidateId, candidateIndex, model: "未调用", attempt: 1, mode: "anchor-candidate",
    status: "failed", startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt,
    referenceImageCount: 0, referenceImagesIncluded: false, failurePhase,
    errorCode: code.slice(0, 80), errorName: error instanceof Error ? error.name : typeof error,
    errorSummary: error instanceof Error ? error.message : String(error),
    causeCode: typeof cause?.code === "string" ? cause.code.slice(0, 80) : undefined
  });
}

function anchorAttemptId(eventId: string, candidateId: string, suffix: string) {
  const digest = createHash("sha256").update(`${eventId}:${candidateId}:${suffix}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function setCurrentCandidate(
  sessionId: string,
  projectId: string,
  source: GenerationProject,
  body: Extract<z.infer<typeof requestSchema>, { action: "set-current" }>,
  expectedVersion: number
) {
  const normalized = ensureVisualAnchorWorkspace(source);
  const candidate = normalized.visualAnchorWorkspace![body.kind === "character" ? "characterCandidates" : "sceneCandidates"]
    .find((item) => item.id === body.candidateId && item.targetId === body.targetId);
  if (!candidate) throw new Error("VISUAL_ANCHOR_CANDIDATE_NOT_FOUND");
  return mutateOwnedAnonymousProject(sessionId, projectId, (latest) => {
    return ensureVisualAnchorWorkspace(selectVisualAnchorCandidate(latest, body.kind, body.targetId, body.candidateId));
  }, expectedVersion).then(async (saved) => {
    await startGenerationEvent(sessionId, projectId, {
      stage: "anchors",
      provider: "system",
      action: "选择候选",
      message: `${body.kind === "character" ? "人物" : "场景"}候选已选中，等待用户确认。`
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
  const normalized = ensureVisualAnchorWorkspace(source);
  const resourceId = getVisualAnchorResourceId(body.kind, body.targetId);
  const resourceType = body.kind === "product" ? "product-master" : `${body.kind}-master` as VersionedResourceType;
  const spec = body.kind === "character" ? normalized.characterVisualSpecs?.find((item) => item.id === body.targetId)
    : body.kind === "scene" ? normalized.sceneVisualSpecs?.find((item) => item.id === body.targetId) : undefined;
  const selection = body.kind === "product" || !body.targetId ? undefined : getVisualAnchorSelection(normalized, body.kind, body.targetId);
  const selected = body.kind === "product" ? undefined : normalized.visualAnchorWorkspace?.[body.kind === "character" ? "characterCandidates" : "sceneCandidates"]
    .find((item) => item.id === selection?.selectedCandidateId);
  const changingLockedMaster = Boolean(spec?.locked && selected && currentMasterAssetId(spec) !== selected.assetId);
  if (changingLockedMaster && !body.createVersion) {
    const current = currentResourceVersion(normalized.resourceVersions ?? [], resourceId);
    const impact = current ? createResourceVersionInProject(normalized, { resourceId, resourceType, stageId: "anchors" }).impact : undefined;
    throw new StageGateError("LOCKED_RESOURCE_VERSION_REQUIRED", `确认更换已锁定的${body.kind === "character" ? "人物" : "场景"}基准前需要创建新版本。`, impact);
  }
  await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => {
    let next = lockVisualAnchorMaster(latest, body.kind, body.targetId);
    const current = currentResourceVersion(next.resourceVersions ?? [], resourceId);
    if (!current || changingLockedMaster) {
      const created = createResourceVersionInProject(next, {
        resourceId,
        resourceType,
        stageId: "anchors",
        label: `${body.kind === "product" ? "产品" : body.kind === "character" ? "人物" : "场景"}参考 第 ${current ? current.version + 1 : 1} 版`,
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
    action: "确认视觉基准",
    message: `${body.kind === "product" ? "产品" : body.kind === "character" ? "人物" : "场景"}基准已由用户确认；后续生成将使用当前参考。`
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
