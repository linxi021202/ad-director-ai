import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { generateQwenImageAdaptive, type QwenModelAttempt } from "@/lib/image/qwenImageModelRouter";
import type { QwenImageResult } from "@/lib/image/types";
import { upsertModelCallLog } from "@/lib/logs/modelCallStore";
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
import { buildCharacterCandidatePrompt, buildSceneCandidatePrompt, VISUAL_ANCHOR_NEGATIVE_PROMPT } from "@/lib/visual/anchorPrompts";
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
  if (body.candidateIndex && body.count !== 1) return failure("VISUAL_ANCHOR_INVALID_CANDIDATE", "补生成单个候选时数量必须为 1。", 400);
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
  const setId = randomUUID();
  const indexes = body.candidateIndex ? [body.candidateIndex] : Array.from({ length: body.count }, (_, index) => index + 1);
  const candidateIds = new Map(indexes.map((index) => [index, randomUUID()]));
  let candidatesStarted = false;
  try {
    const planned = body.kind === "character"
      ? await generateCharacterCandidateDirections(target as NonNullable<GenerationProject["visualAnchorWorkspace"]>["characterBriefs"][number], { sessionId, maxProviderAttempts: 1 })
      : await generateSceneCandidateDirections(target as SceneVisualSpec, { sessionId, maxProviderAttempts: 1 });
    const directions = planned.success && planned.data ? planned.data : body.kind === "character"
      ? fallbackCharacterDirections(target as NonNullable<GenerationProject["visualAnchorWorkspace"]>["characterBriefs"][number])
      : fallbackSceneDirections(target as SceneVisualSpec);
    const requested = indexes.map((index) => ({ id: candidateIds.get(index)!, index, direction: directions[index - 1] }));
    const runCandidate = async (candidate: (typeof requested)[number], repair = false, repairPrompt?: string) => {
      const startedAt = Date.now();
      let prompt: string;
      try {
        if (!candidate.direction) throw new Error(`候选 ${candidate.index} 缺少创意方向。`);
        prompt = repairPrompt ?? (body.kind === "character"
          ? buildCharacterCandidatePrompt(target as NonNullable<GenerationProject["visualAnchorWorkspace"]>["characterBriefs"][number], candidate.direction as CharacterCandidateDirection)
          : buildSceneCandidatePrompt(target as SceneVisualSpec, candidate.direction as SceneCandidateDirection));
      } catch (error) {
        await logAnchorCandidateFailure(sessionId, projectId, event, body.kind, candidate.id, candidate.index, "PROMPT_BUILD_FAILED", error, startedAt, repair);
        return { requestItem: { ...candidate, prompt: "" }, result: null };
      }
      const requestItem = { ...candidate, prompt };
      let modelAttemptSeen = false;
      try {
        const result = await generateQwenImageAdaptive({
          prompt, negativePrompt: VISUAL_ANCHOR_NEGATIVE_PROMPT, projectId,
          shotId: `anchor-${body.kind}-${body.targetId}-${candidate.id}${repair ? "-repair" : ""}`,
          sessionId, size: body.kind === "character" ? "1152*2048" : "2048*1152", watermark: false
        }, (attempt) => {
          modelAttemptSeen = true;
          return logAnchorModelAttempt(sessionId, projectId, event, body.kind, candidate.id, candidate.index, attempt, repair);
        });
        if (!modelAttemptSeen) await logAnchorCandidateResult(sessionId, projectId, event, body.kind, candidate.id, candidate.index, result, startedAt, repair);
        return { requestItem, result };
      } catch (error) {
        const phase = error instanceof Error && error.message === "SUBMISSION_STATE_UNKNOWN" ? "MODEL_SUBMISSION_FAILED"
          : modelAttemptSeen ? "UNKNOWN" : "MODEL_ROUTING_FAILED";
        await logAnchorCandidateFailure(sessionId, projectId, event, body.kind, candidate.id, candidate.index, phase, error, startedAt, repair);
        return { requestItem, result: null };
      }
    };
    candidatesStarted = true;
    let results = await Promise.all(requested.map((candidate) => runCandidate(candidate)));
    const initialAssetIds = results.flatMap(({ result }) => result?.success && result.assetId ? [result.assetId] : []);
    const diversity = await inspectCandidateDiversity({ kind: body.kind, assetIds: initialAssetIds, sessionId, projectId });
    if (!diversity.passed && initialAssetIds.length === body.count) {
      const repairIndexes = new Set(diversity.tooSimilarIndexes.slice(0, 2));
      results = await Promise.all(results.map(async (result, index) => {
        if (!repairIndexes.has(index + 1)) return result;
        const candidate = requested[index]!;
        const repaired = await runCandidate(candidate,
          true, `${result.requestItem.prompt}\n多样性修复：上一版与其他方案过于相似。必须强化本方向的独有脸型/空间拓扑、轮廓、材质和构图差异，同时保持角色或场景功能不变。`);
        return repaired.result?.success && repaired.result.assetId ? { ...result, result: repaired.result } : result;
      }));
    }
    const successful = results.filter((item): item is { requestItem: (typeof results)[number]["requestItem"]; result: QwenImageResult } => Boolean(item.result?.success && item.result.assetId));
    if (successful.length === 0) {
      const firstCode = results.find((item) => item.result?.errorCode)?.result?.errorCode;
      await failGenerationEvent(sessionId, projectId, event.id, "本次候选均未生成成功，已有候选保持不变。", "PROVIDER_REQUEST_FAILED");
      const guidance = firstCode === "INSUFFICIENT_BALANCE" ? "模型服务账户余额不足，请检查当前 Qwen 密钥对应账户。"
        : firstCode === "AUTH_FAILED" ? "Qwen 密钥未通过验证，请在模型设置中检查。"
        : "本次候选均未生成成功，请查看对应候选的调用日志。";
      return failure("VISUAL_ANCHOR_GENERATION_FAILED", guidance, 502);
    }
    const now = new Date().toISOString();
    const nextVersion = Math.max(0, ...(project.visualAnchorWorkspace![body.kind === "character" ? "characterCandidates" : "sceneCandidates"]
      .filter((candidate) => candidate.targetId === body.targetId)
      .map((candidate) => candidate.version))) + 1;
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
      setVersion: nextVersion,
      status: "ready",
      recommended: index === 0,
      version: nextVersion,
      createdAt: now
    }));
    await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => replaceVisualAnchorCandidates(latest, body.kind, body.targetId, candidates, now, successful.length < body.count || Boolean(body.candidateIndex)));
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
    if (!candidatesStarted) await Promise.all(indexes.map((index) => logAnchorCandidateFailure(sessionId, projectId, event, body.kind,
      candidateIds.get(index)!, index, "PROMPT_BUILD_FAILED", error, event.startedAt).catch(() => undefined)));
    await failGenerationEvent(sessionId, projectId, event.id, "视觉候选生成失败。", "PROVIDER_REQUEST_FAILED").catch(() => undefined);
    throw error;
  }
}

type AnchorFailurePhase = "PROMPT_BUILD_FAILED" | "REFERENCE_ASSET_LOAD_FAILED" | "REFERENCE_URL_BUILD_FAILED"
  | "MODEL_ROUTING_FAILED" | "MODEL_REQUEST_FAILED" | "MODEL_SUBMISSION_FAILED"
  | "MODEL_GENERATION_FAILED" | "OUTPUT_PARSE_FAILED" | "ASSET_DOWNLOAD_FAILED"
  | "ASSET_PERSIST_FAILED" | "UNKNOWN";

function anchorFailurePhase(result: QwenImageResult): AnchorFailurePhase | undefined {
  if (result.success && result.assetId) return undefined;
  if (result.errorCode === "ASSET_DOWNLOAD_FAILED") return "ASSET_DOWNLOAD_FAILED";
  if (result.errorCode === "ASSET_PERSIST_FAILED" || (result.success && !result.assetId)) return "ASSET_PERSIST_FAILED";
  if (result.errorCode === "SUBMISSION_STATE_UNKNOWN") return "MODEL_SUBMISSION_FAILED";
  if (result.errorCode === "TASK_POLL_INTERRUPTED") return "MODEL_GENERATION_FAILED";
  if (result.networkFailure?.failurePhase === "JSON_PARSE") return "OUTPUT_PARSE_FAILED";
  if (result.taskId) return "MODEL_GENERATION_FAILED";
  if (result.errorCode === "PROVIDER_NOT_CONFIGURED" || result.errorCode === "MODEL_NOT_AVAILABLE") return "MODEL_ROUTING_FAILED";
  return result.httpStatus || result.requestStartedAt ? "MODEL_REQUEST_FAILED" : "MODEL_ROUTING_FAILED";
}

async function logAnchorModelAttempt(sessionId: string, projectId: string, event: Awaited<ReturnType<typeof startGenerationEvent>>,
  anchorType: VisualAnchorCandidateKind, candidateId: string, candidateIndex: number, attempt: QwenModelAttempt, repair: boolean) {
  const logId = anchorAttemptId(event.id, candidateId, `${repair ? "repair" : "initial"}:${attempt.model}:${attempt.attempt}`);
  await upsertModelCallLog(sessionId, {
    id: logId, kind: "call", taskId: event.id, jobId: event.runId, projectId, stage: "anchors", provider: "qwen-image",
    anchorType, candidateId, candidateIndex, model: attempt.model, attempt: attempt.attempt, mode: attempt.mode,
    status: attempt.status, startedAt: attempt.startedAt, completedAt: attempt.completedAt,
    requestStartedAt: attempt.status === "blocked" ? undefined : attempt.submissionDiagnostic?.requestStartedAt ?? attempt.startedAt,
    requestCompletedAt: attempt.status === "blocked" ? undefined : attempt.completedAt,
    durationMs: Math.max(0, attempt.completedAt - attempt.startedAt),
    referenceImageCount: attempt.referenceCount, referenceImagesIncluded: attempt.referenceCount > 0,
    errorCode: attempt.errorCode, providerErrorCode: attempt.providerErrorCode, errorSummary: attempt.error,
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
  anchorType: VisualAnchorCandidateKind, candidateId: string, candidateIndex: number, result: QwenImageResult,
  startedAt: number, repair: boolean) {
  await upsertModelCallLog(sessionId, {
    id: anchorAttemptId(event.id, candidateId, repair ? "repair:summary" : "initial:summary"),
    kind: "call", taskId: event.id, jobId: event.runId, projectId, stage: "anchors", provider: "qwen-image",
    anchorType, candidateId, candidateIndex, model: result.model, attempt: 1, mode: "anchor-candidate",
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

async function logAnchorCandidateFailure(sessionId: string, projectId: string, event: Awaited<ReturnType<typeof startGenerationEvent>>,
  anchorType: VisualAnchorCandidateKind, candidateId: string, candidateIndex: number, failurePhase: AnchorFailurePhase,
  error: unknown, startedAt: number, repair = false) {
  const cause = error instanceof Error && "cause" in error && error.cause && typeof error.cause === "object"
    ? error.cause as { code?: unknown } : undefined;
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : failurePhase;
  await upsertModelCallLog(sessionId, {
    id: anchorAttemptId(event.id, candidateId, repair ? "repair:exception" : "initial:exception"),
    kind: "call", taskId: event.id, jobId: event.runId, projectId, stage: "anchors", provider: "qwen-image",
    anchorType, candidateId, candidateIndex, model: "未调用", attempt: 1, mode: "anchor-candidate",
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
