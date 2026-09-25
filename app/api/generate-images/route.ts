import { z } from "zod";
import { createHash } from "node:crypto";

import { diagnoseQwenImageFallback } from "../../../lib/api/provider-diagnostics";
import { upsertModelCallLog } from "../../../lib/logs/modelCallStore";
import type { QwenModelAttempt } from "../../../lib/image/qwenImageModelRouter";
import { markPrivateAssetsLifecycle } from "../../../lib/assets/assetStore";
import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { getPublicAIStatus } from "../../../lib/config/ai";
import { selectPrimaryProductImage } from "../../../lib/image/productReference";
import { projectStoreErrorResponse } from "../../../lib/projects/api";
import {
  completeGenerationEvent,
  failGenerationEvent,
  blockUnknownSubmission,
  attachGenerationEventProviderTask,
  markGenerationEventQAReview,
  startGenerationEvent,
  updateGenerationEventProgress
} from "../../../lib/projects/generationEvents";
import {
  anonymousProjectIdSchema,
  mutateOwnedAnonymousProject,
  requireOwnedAnonymousProject,
  updateOwnedAnonymousProject
} from "../../../lib/projects/anonymousProjectStore";
import { generateShotImage, selectProviderModel } from "../../../lib/providers/providerRouter";
import { aspectRatioSchema, productImageSchema, storyboardShotSchema, type KeyframeQAResult, type ShotFrame } from "../../../lib/schemas/project";
import type { ShotImageGenerationResult } from "../../../lib/providers/types";
import type { QwenTaskProgress } from "../../../lib/image/types";
import { getAnonymousApiSession } from "../../../lib/session/api";
import { MAX_SHOT_COUNT, getDefaultHeroShotArrayIndex } from "../../../lib/video/shotConfig";
import { selectLockedMasterAssetIds } from "../../../lib/continuity/visualMasters";
import { selectImageReferencesForShot } from "../../../lib/image/referenceSelector";
import { archiveSupersededKeyframe, keepApprovedKeyframe } from "../../../lib/image/keyframeVersions";
import type { ProductVisualSpec } from "../../../lib/schemas/project";
import { createMockKeyframeQA, inspectKeyframe } from "../../../lib/visual/visualQA";
import { ensureShotArchitecture } from "../../../lib/storyboard/shotArchitecture";
import { ensureVisualAnchorWorkspace, getVisualAnchorReadiness } from "../../../lib/visual/visualAnchors";

const QWEN_FRAME_CONCURRENCY = 2;

function frameSubmissionFingerprint(projectId: string, shot: TargetShot, frame: ShotFrame, keyframeVersion: string) {
  return createHash("sha256").update(JSON.stringify({ projectId, shotId: shot.id, frameId: frame.id,
    model: "qwen-image-3.0", keyframeVersion, promptCn: frame.imagePromptCn, promptEn: frame.imagePromptEn })).digest("hex");
}

const requestSchema = z.object({
  projectId: anonymousProjectIdSchema,
  shots: z.array(storyboardShotSchema).min(1).max(12),
  mode: z.enum(["hero-only", "all-shots"]),
  aspectRatio: aspectRatioSchema.optional().default("9:16"),
  productImages: z.array(productImageSchema).max(3).optional(),
  frameIds: z.array(z.string().min(1)).max(60).optional()
}).strict();

const batchEventIdSchema = z.string().uuid();
type TargetShot = z.infer<typeof storyboardShotSchema>;
type TargetFrame = { shot: TargetShot; frame: ShotFrame };
type ImageBatchInput = {
  sessionId: string;
  projectId: string;
  targetShots: TargetShot[];
  targetFrames: TargetFrame[];
  aspectRatio: z.infer<typeof aspectRatioSchema>;
  productImage: ReturnType<typeof selectPrimaryProductImage>;
  productImages: z.infer<typeof productImageSchema>[];
  mode: "hero-only" | "all-shots";
  requestedShots: number;
  continuityImageAssetId?: string;
  productVisualSpec?: ProductVisualSpec;
  masterReferenceAssetIdsByShot: Record<string, string[]>;
  batchEventId: string;
  batchRunId: string;
  shotEvents: Map<string, string>;
  resumeTaskIdsByFrame?: Map<string, string>;
};

const globalImageJobs = globalThis as typeof globalThis & {
  __adDirectorImageJobs?: Map<string, Promise<void>>;
};
const imageJobs = globalImageJobs.__adDirectorImageJobs ?? new Map<string, Promise<void>>();
globalImageJobs.__adDirectorImageJobs = imageJobs;

function selectTargetShots(
  shots: z.infer<typeof storyboardShotSchema>[],
  mode: "hero-only" | "all-shots",
  _maxImagesPerRun: number,
  heroShotId?: string | null
) {
  if (mode === "hero-only") {
    return [shots.find((shot) => shot.id === heroShotId) ?? shots[getDefaultHeroShotArrayIndex(shots.length)] ?? shots[0]];
  }
  return shots.slice(0, MAX_SHOT_COUNT);
}

function selectTargetFrames(shots: TargetShot[], frameIds?: string[]): TargetFrame[] {
  const requested = frameIds ? new Set(frameIds) : null;
  return shots.flatMap((rawShot) => {
    const shot = ensureShotArchitecture(rawShot);
    return (shot.frames ?? []).filter((frame) => !frame.isLocked && (!requested || requested.has(frame.id))).map((frame) => ({ shot, frame }));
  });
}

export async function POST(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  let batchEventId: string | undefined;
  let activeProjectId: string | undefined;

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiJson({
        success: false,
        data: null,
        trace: { route: "generate-images", stage: "validation" },
        fallbackUsed: false,
        error: "项目 ID 或关键帧请求无效。"
      }, 400);
    }

    const owned = await requireOwnedAnonymousProject(session.id, parsed.data.projectId);
    const anchorProject = ensureVisualAnchorWorkspace(owned.project);
    const anchorReadiness = getVisualAnchorReadiness(anchorProject);
    if (anchorProject.stageStates?.anchors.status !== "locked" || !anchorReadiness.ready) {
      return apiJson({
        success: false,
        data: null,
        trace: { route: "generate-images", stage: "visual-anchor-gate", anchorReadiness },
        fallbackUsed: false,
        error: "视觉设定尚未确认：请先确认产品、主角和主要场景。"
      }, 400);
    }
    const publicStatus = getPublicAIStatus();
    const maxImagesPerRun = publicStatus.limits.maxImagesPerRun;
    const requestedShotIds = parsed.data.shots.map((shot) => shot.id);
    const requestedShots = requestedShotIds
      .map((shotId) => owned.project.shots.find((shot) => shot.id === shotId))
      .filter((shot): shot is (typeof owned.project.shots)[number] => Boolean(shot));
    if (requestedShots.length !== requestedShotIds.length) {
      return apiJson({
        success: false,
        data: null,
        trace: { route: "generate-images", stage: "project-shot-validation" },
        fallbackUsed: false,
        error: "请求包含不属于当前项目的镜头。"
      }, 400);
    }
    const targetShots = selectTargetShots(requestedShots, parsed.data.mode, maxImagesPerRun, owned.project.heroShotId);
    const targetFrames = selectTargetFrames(targetShots, parsed.data.frameIds);
    if (!targetFrames.length) {
      return apiJson({ success: false, data: null, trace: { route: "generate-images", stage: "frame-validation" }, fallbackUsed: false, error: "没有找到可生成的镜头帧。" }, 400);
    }
    const fingerprintByFrame = new Map(targetFrames.map(({ shot, frame }) => {
      const version = owned.project.keyframeVersions?.filter((item) => item.shotId === shot.id && item.frameId === frame.id)
        .map((item) => item.assetId ?? "").join(":") ?? "";
      return [frame.id, frameSubmissionFingerprint(owned.project.id, shot, frame, version)];
    }));
    const unresolved = owned.project.generationEvents?.find((item) => item.stage === "keyframes" && item.action === "生成单帧关键帧"
      && item.errorCode === "SUBMISSION_STATE_UNKNOWN" && item.submissionFingerprint === fingerprintByFrame.get(item.frameId ?? ""));
    if (unresolved) return apiJson({ success: false, data: null,
      trace: { route: "generate-images", stage: "submission-unresolved", eventId: unresolved.id }, fallbackUsed: false,
      error: "提交状态未知，请先检查任务状态和调用日志；为避免重复计费，当前帧暂不可重新提交。" }, 409);
    const activeBatch = owned.project.generationEvents?.find((item) => item.stage === "keyframes" && item.action === "生成关键帧批次" && item.status === "running");
    if (activeBatch) {
      return apiJson({ success: false, data: null, trace: { route: "generate-images", stage: "existing-batch", eventId: activeBatch.id }, fallbackUsed: false,
        error: "已有关键帧任务正在处理，请等待当前任务完成；刷新页面后会继续显示进度。" }, 409);
    }
    activeProjectId = parsed.data.projectId;
    const batchEvent = await startGenerationEvent(session.id, activeProjectId, {
      stage: "keyframes", provider: "qwen-image", action: "生成关键帧批次",
      message: `Qwen-Image 正在逐帧生成 ${targetFrames.length} 张独立关键帧。`, progressCurrent: 0, progressTotal: targetFrames.length
    });
    batchEventId = batchEvent.id;
    const shotEvents = new Map<string, string>();
    for (const { shot, frame } of targetFrames) {
      const event = await startGenerationEvent(session.id, activeProjectId, {
        stage: "keyframes", provider: "qwen-image", action: "生成单帧关键帧",
        message: `正在生成镜头 ${shot.index} 的第 ${frame.index + 1} 帧。`, shotId: shot.id, frameId: frame.id,
        submissionFingerprint: fingerprintByFrame.get(frame.id), runId: batchEvent.runId
      });
      shotEvents.set(frame.id, event.id);
    }
    const imageRoute = selectProviderModel({ taskType: "image", hasChineseText: true });
    const productImage = selectPrimaryProductImage(owned.project.brief.productImages);
    const batchInput: ImageBatchInput = {
      sessionId: session.id,
      projectId: activeProjectId,
      targetShots,
      targetFrames,
      aspectRatio: parsed.data.aspectRatio,
      productImage,
      productImages: owned.project.brief.productImages ?? [],
      mode: parsed.data.mode,
      requestedShots: parsed.data.shots.length,
      continuityImageAssetId: findPreviousContinuityAssetId(owned.project, targetShots),
      productVisualSpec: anchorProject.productVisualSpec,
      masterReferenceAssetIdsByShot: Object.fromEntries(targetShots.map((shot) => [
        shot.id,
        selectLockedMasterAssetIds(owned.project, shot)
      ])),
      batchEventId: batchEvent.id,
      batchRunId: batchEvent.runId,
      shotEvents
    };

    if (imageRoute.provider === "qwenImageProvider") {
      launchImageBatch(batchInput);
      return apiJson({
        success: true,
        data: {
          status: "running",
          eventId: batchEvent.id,
          mode: parsed.data.mode,
          requestedShots: parsed.data.shots.length,
          generatedShots: 0,
          images: [],
          failedShots: []
        },
        trace: {
          route: "generate-images",
          taskType: "image",
          mode: parsed.data.mode,
          provider: imageRoute.provider,
          model: imageRoute.model,
          maxImagesPerRun,
          execution: "background-polling"
        },
        fallbackUsed: false,
        fallbackReason: null,
        error: null
      }, 202);
    }

    const completed = await queueImageBatch(batchInput);
    return apiJson({
      success: true,
      data: { status: "completed", eventId: batchEvent.id, ...completed },
      trace: {
        route: "generate-images",
        taskType: "image",
        mode: parsed.data.mode,
        provider: imageRoute.provider,
        model: imageRoute.model,
        maxImagesPerRun,
        productReferenceRequested: Boolean(productImage),
        productReferenceUsed: completed.images.some((image) => image.referenceUsed),
        generatedShotIds: completed.images.map((image) => image.shotId)
      },
      fallbackUsed: completed.failedShots.length > 0,
      fallbackReason: completed.failedShots.length > 0 ? `${completed.failedShots.length} 个镜头使用了关键帧降级。` : null,
      error: null
    });
  } catch (error) {
    if (batchEventId && activeProjectId) await failGenerationEvent(session.id, activeProjectId, batchEventId, "关键帧批次生成失败，请检查模型配置后重试。").catch(() => undefined);
    const projectError = projectStoreErrorResponse(error);
    if (projectError) return projectError;
    return apiJson({
      success: false,
      data: null,
      trace: { route: "generate-images", stage: "exception" },
      fallbackUsed: false,
      error: sanitizeApiError(error)
    }, 500);
  }
}

export async function GET(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;

  try {
    const url = new URL(request.url);
    const projectId = anonymousProjectIdSchema.safeParse(url.searchParams.get("projectId"));
    const eventId = batchEventIdSchema.safeParse(url.searchParams.get("eventId"));
    if (!projectId.success || !eventId.success) {
      return apiJson({ success: false, data: null, trace: { route: "generate-images", stage: "status-validation" }, fallbackUsed: false, error: "缺少有效的关键帧任务信息。" }, 400);
    }

    const owned = await requireOwnedAnonymousProject(session.id, projectId.data);
    const event = owned.project.generationEvents?.find((item) => item.id === eventId.data);
    if (!event || event.provider !== "qwen-image" || event.action !== "生成关键帧批次") {
      return apiJson({ success: false, data: null, trace: { route: "generate-images", stage: "status-ownership" }, fallbackUsed: false, error: "当前会话中不存在这个关键帧任务。" }, 404);
    }

    if (["failed", "cancelled", "blocked", "interrupted"].includes(event.status)) {
      return apiJson({ success: false, data: null, trace: { route: "generate-images", stage: "batch-failed", errorCode: event.errorCode }, fallbackUsed: false, error: event.message }, 409);
    }

    if (event.status === "running" || event.status === "queued" || event.status === "qa-review") {
      const recovering = !imageJobs.has(projectId.data);
      if (!imageJobs.has(projectId.data)) {
        const frameEvents = (owned.project.generationEvents ?? []).filter((item) => item.runId === event.runId && item.action === "生成单帧关键帧" && item.status === "running");
        if (frameEvents.length && frameEvents.every((item) => item.providerTaskId && item.shotId && item.frameId)) {
          const targetFrames = frameEvents.flatMap((item) => {
            const shot = owned.project.shots.find((candidate) => candidate.id === item.shotId);
            const frame = shot?.frames?.find((candidate) => candidate.id === item.frameId);
            return shot && frame ? [{ shot, frame }] : [];
          });
          if (targetFrames.length === frameEvents.length) {
            const targetShots = [...new Map(targetFrames.map(({ shot }) => [shot.id, shot])).values()];
            const anchorProject = ensureVisualAnchorWorkspace(owned.project);
            launchImageBatch({ sessionId: session.id, projectId: projectId.data, targetShots, targetFrames,
              aspectRatio: owned.project.brief.aspectRatio ?? "9:16", productImage: selectPrimaryProductImage(owned.project.brief.productImages),
              productImages: owned.project.brief.productImages ?? [], mode: "all-shots", requestedShots: targetShots.length,
              continuityImageAssetId: findPreviousContinuityAssetId(owned.project, targetShots), productVisualSpec: anchorProject.productVisualSpec,
              masterReferenceAssetIdsByShot: Object.fromEntries(targetShots.map((shot) => [shot.id, selectLockedMasterAssetIds(owned.project, shot)])),
              batchEventId: event.id, batchRunId: event.runId,
              shotEvents: new Map(frameEvents.map((item) => [item.frameId!, item.id])),
              resumeTaskIdsByFrame: new Map(frameEvents.map((item) => [item.frameId!, item.providerTaskId!])) });
          }
        } else if (frameEvents.length) {
          await Promise.all(frameEvents.filter((item) => !item.providerTaskId).map((item) =>
            blockUnknownSubmission(session.id, projectId.data, item.id)));
          await blockUnknownSubmission(session.id, projectId.data, event.id);
          return apiJson({ success: false, data: null, trace: { route: "generate-images", stage: "submission-unresolved" }, fallbackUsed: false,
            error: "部分镜头的提交状态无法确认，已停止自动重试，避免重复生成。" }, 409);
        } else {
          const batchData = imageBatchDataFromProject(owned.project, event.runId);
          if (batchData.images.length === batchData.requestedShots) {
            await completeGenerationEvent(session.id, projectId.data, event.id, "关键帧批次已恢复完成。",
              { status: batchData.failedShots.length ? "fallback" : "completed", progressCurrent: batchData.images.length, progressTotal: batchData.requestedShots });
          } else {
            await blockUnknownSubmission(session.id, projectId.data, event.id);
            return apiJson({ success: false, data: null, trace: { route: "generate-images", stage: "submission-unresolved" }, fallbackUsed: false,
              error: "关键帧任务已中断，提交状态无法确认，请查看调用日志。" }, 409);
          }
        }
      }
      return apiJson({
        success: true,
        data: {
          status: "running",
          eventId: event.id,
          generatedShots: event.progressCurrent ?? 0,
          requestedShots: event.progressTotal ?? 1,
          message: recovering ? "正在恢复生成任务，已提交的图片不会重复提交。" : event.message,
          images: [],
          failedShots: []
        },
        trace: { route: "generate-images", stage: recovering ? "batch-recovering" : "batch-running" },
        fallbackUsed: false,
        fallbackReason: null,
        error: null
      }, 202);
    }

    const data = imageBatchDataFromProject(owned.project, event.runId);
    return apiJson({
      success: true,
      data: { status: "completed", eventId: event.id, ...data },
      trace: { route: "generate-images", stage: "batch-completed" },
      fallbackUsed: data.failedShots.length > 0,
      fallbackReason: data.failedShots.length > 0 ? `${data.failedShots.length} 个镜头使用了关键帧降级。` : null,
      error: null
    });
  } catch (error) {
    const projectError = projectStoreErrorResponse(error);
    if (projectError) return projectError;
    return apiJson({ success: false, data: null, trace: { route: "generate-images", stage: "status-exception" }, fallbackUsed: false, error: sanitizeApiError(error) }, 500);
  }
}

function launchImageBatch(input: ImageBatchInput) {
  void queueImageBatch(input).catch(() => undefined);
}

function queueImageBatch(input: ImageBatchInput) {
  const previous = imageJobs.get(input.projectId) ?? Promise.resolve();
  const job = previous.catch(() => undefined).then(() => executeImageBatch(input));
  const tracked = job.then(() => undefined, () => undefined).finally(() => {
    if (imageJobs.get(input.projectId) === tracked) imageJobs.delete(input.projectId);
  });
  imageJobs.set(input.projectId, tracked);
  return job;
}

type EvaluatedImage = ShotImageGenerationResult & {
  qaResult?: KeyframeQAResult;
  qaResults?: KeyframeQAResult[];
  status: "ready" | "needs-review" | "fallback";
};

async function executeImageBatch(input: ImageBatchInput) {
  try {
    let completedCount = 0;
    const results: EvaluatedImage[] = [];
    const previousAssetByGroup = new Map<string, string>();
    const firstGroup = input.targetShots[0]?.continuityGroupId ?? input.targetShots[0]?.sceneGroupId;
    if (firstGroup && input.continuityImageAssetId) previousAssetByGroup.set(firstGroup, input.continuityImageAssetId);

    await runContinuityAware(input.targetFrames, async ({ shot, frame }) => {
      const groupId = shot.continuityGroupId ?? shot.sceneGroupId;
      let project = (await requireOwnedAnonymousProject(input.sessionId, input.projectId)).project;
      const frameShot = shotForFrame(shot, frame);
      const qaShot = { ...frameShot, id: shot.id };
      const references = selectImageReferencesForShot(project, shot);
      const eventId = input.shotEvents.get(frame.id);
      const logIds = new Map<string, string>();
      const progressByModel = new Map<string, QwenTaskProgress>();
      const onModelAttempt = eventId ? async (attempt: QwenModelAttempt) => {
        const logKey = `${attempt.model}:${attempt.attempt}`;
        const digest = createHash("sha256").update(`${eventId}:${logKey}`).digest("hex");
        const logId = logIds.get(logKey) ?? `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        logIds.set(logKey, logId);
        const progress = progressByModel.get(attempt.model);
        await upsertModelCallLog(input.sessionId, {
          id: logId,
          kind: "call", taskId: eventId, jobId: input.batchRunId, projectId: input.projectId,
          stage: "keyframes", provider: "qwen-image", model: attempt.model, mode: attempt.mode,
          shotId: shot.id, frameId: frame.id, attempt: attempt.attempt, status: attempt.status,
          startedAt: attempt.startedAt, completedAt: attempt.completedAt,
          durationMs: Math.max(0, attempt.completedAt - attempt.startedAt),
          errorCode: attempt.errorCode, errorSummary: attempt.error, providerErrorCode: attempt.providerErrorCode,
          httpStatus: attempt.httpStatus, providerRequestId: attempt.requestId, providerTaskId: attempt.taskId,
          referenceImageCount: attempt.referenceCount, referenceImagesIncluded: attempt.referenceCount > 0,
          requestOptions: { size: attempt.size, referenceCount: attempt.referenceCount, endpointMode: attempt.model === "qwen-image-3.0" ? "dashscope-async" : "dashscope-sync", promptExtend: attempt.promptExtend, watermark: attempt.watermark },
          submissionStatus: attempt.taskId ? "submitted" : attempt.status === "failed" ? "failed" : undefined,
          providerTaskStatus: attempt.providerStatus ?? (attempt.taskId && attempt.status !== "running"
            ? attempt.status === "completed" || attempt.errorCode?.startsWith("ASSET_") ? "SUCCEEDED" : "FAILED" : progress?.status),
          submittedAt: attempt.submittedAt ?? progress?.submittedAt, lastPolledAt: attempt.lastPolledAt ?? progress?.lastPolledAt,
          pollCount: attempt.pollCount ?? progress?.pollCount, nextPollAt: attempt.status === "running" ? Date.now() + 3000 : undefined,
          generationElapsedMs: (attempt.submittedAt ?? progress?.submittedAt) ? Date.now() - (attempt.submittedAt ?? progress!.submittedAt) : undefined,
          submissionElapsedMs: attempt.submissionElapsedMs, downloadElapsedMs: attempt.downloadElapsedMs,
          requestHost: attempt.submissionDiagnostic?.requestHost, requestPath: attempt.submissionDiagnostic?.requestPath,
          region: attempt.submissionDiagnostic?.region, workspaceIdMasked: attempt.submissionDiagnostic?.workspaceIdMasked,
          apiMode: attempt.submissionDiagnostic?.apiMode, payloadBytes: attempt.submissionDiagnostic?.payloadBytes,
          submissionTimeoutMs: attempt.submissionDiagnostic?.timeoutMs,
          referenceSourceTypes: attempt.submissionDiagnostic?.referenceTypes,
          failurePhase: attempt.networkFailure?.failurePhase,
          networkErrorName: attempt.networkFailure?.errorName, networkErrorMessage: attempt.networkFailure?.errorMessage,
          networkCauseCode: attempt.networkFailure?.causeCode, networkCauseErrno: attempt.networkFailure?.causeErrno,
          networkCauseSyscall: attempt.networkFailure?.causeSyscall,
          finalAssetId: attempt.assetId,
          imageUrl: attempt.assetId ? `/api/projects/${input.projectId}/assets/${attempt.assetId}` : undefined,
          ...(attempt.assetId ? { outputAssetIds: [attempt.assetId] } : {})
        });
      } : undefined;
      const onTaskProgress = eventId ? async (progress: QwenTaskProgress) => {
        progressByModel.set("qwen-image-3.0", progress);
        await attachGenerationEventProviderTask(input.sessionId, input.projectId, eventId,
          { taskId: progress.taskId, requestId: progress.requestId, status: "running",
            message: progress.status === "PENDING" ? "关键帧任务已提交，正在等待模型处理。" : progress.status === "RUNNING" ? "关键帧正在生成。" : progress.status === "FAILED" ? "服务商任务已结束，正在核对失败原因。" : "关键帧生成完成，正在保存图片。" });
      } : undefined;
      let generated: ShotImageGenerationResult;
      try { generated = await generateShotImage(input.projectId, frameShot, {
        aspectRatio: input.aspectRatio,
        hasChineseText: true,
        sessionId: input.sessionId,
        productImage: input.productImage,
        productImages: references.productImages,
        productVisualSpec: input.productVisualSpec,
        masterReferenceAssetIds: references.masterReferenceAssetIds,
        continuityImageAssetId: groupId ? previousAssetByGroup.get(groupId) : undefined,
        onModelAttempt,
        onTaskProgress,
        resumeTaskId: input.resumeTaskIdsByFrame?.get(frame.id)
      }); } catch (error) {
        if (error instanceof Error && error.message === "SUBMISSION_STATE_UNKNOWN" && eventId) {
          await blockUnknownSubmission(input.sessionId, input.projectId, eventId);
        }
        throw error;
      }
      let result: ShotImageGenerationResult = { ...generated, shotId: shot.id, frameId: frame.id };
      let qaResult: KeyframeQAResult | undefined;
      const qaResults: KeyframeQAResult[] = [];
      let status: EvaluatedImage["status"] = result.fallbackUsed || !result.assetId ? "fallback" : "ready";

      if (!result.fallbackUsed && result.provider === "mockImageProvider") {
        qaResult = createMockKeyframeQA(qaShot, 1, frame.id);
        qaResults.push(qaResult);
        status = "ready";
      } else if (!result.fallbackUsed && result.assetId) {
        await persistKeyframeState(input, shot, frame, result, "generated");
        if (eventId) await markGenerationEventQAReview(input.sessionId, input.projectId, eventId, `镜头 ${shot.index} 第 ${frame.index + 1} 帧已生成，正在执行视觉一致性检查。`);
        await persistKeyframeState(input, shot, frame, result, "text-qa");
        project = (await requireOwnedAnonymousProject(input.sessionId, input.projectId)).project;
        qaResult = await inspectKeyframe({
              sessionId: input.sessionId,
              project,
              shot: qaShot,
              frameId: frame.id,
              candidateAssetId: result.assetId,
              productAssetId: shot.containsProduct ? input.productImage?.assetId : undefined,
              masterAssetIds: selectLockedMasterAssetIds(project, shot),
              attempt: 1
            });
        qaResults.push(qaResult);
        await persistKeyframeState(input, shot, frame, result, "product-qa");
        if ((shot.characterIds ?? []).length) await persistKeyframeState(input, shot, frame, result, "character-qa");
        if (shot.sceneId) await persistKeyframeState(input, shot, frame, result, "scene-qa");

        if (!qaResult.overallPassed && result.provider !== "deterministic-product-master") {
          if (result.assetId !== input.productImage?.assetId) {
            await markPrivateAssetsLifecycle(input.sessionId, input.projectId, [result.assetId], "orphaned");
          }
          const repairedShot = {
            ...frameShot,
            imagePromptCn: `${frameShot.imagePromptCn}\n只修复当前这一帧，禁止增加面板、拼贴或其他时刻。视觉 QA 定向修复：${qaResult.repairPrompt ?? qaResult.issues.join("；")}`,
            imagePromptEn: `${frameShot.imagePromptEn}\nRepair this frame only. One full-frame image, no panels, collage, contact sheet, or additional moments.`
          };
          result = { ...await generateShotImage(input.projectId, repairedShot, {
            aspectRatio: input.aspectRatio,
            hasChineseText: true,
            sessionId: input.sessionId,
            productImage: input.productImage,
            productImages: selectImageReferencesForShot(project, shot).productImages,
            productVisualSpec: input.productVisualSpec,
            masterReferenceAssetIds: selectImageReferencesForShot(project, shot).masterReferenceAssetIds,
            continuityImageAssetId: groupId ? previousAssetByGroup.get(groupId) : undefined,
            onModelAttempt
          }), shotId: shot.id, frameId: frame.id };
          if (!result.fallbackUsed && result.assetId) {
            await persistKeyframeState(input, shot, frame, result, "generated");
            qaResult = await inspectKeyframe({
              sessionId: input.sessionId,
              project: (await requireOwnedAnonymousProject(input.sessionId, input.projectId)).project,
              shot: { ...repairedShot, id: shot.id },
              frameId: frame.id,
              candidateAssetId: result.assetId,
              productAssetId: shot.containsProduct ? input.productImage?.assetId : undefined,
              masterAssetIds: selectLockedMasterAssetIds(project, shot),
              attempt: 2
            });
            qaResults.push(qaResult);
          }
        }
        status = result.fallbackUsed || !result.assetId ? "fallback" : qaResult?.overallPassed ? "ready" : "needs-review";
      }

      const evaluated: EvaluatedImage = { ...result, qaResult, qaResults, status };
      results.push(evaluated);
      await persistEvaluatedKeyframe(input, shot, frame, evaluated);
      if (groupId && evaluated.assetId && evaluated.status === "ready") previousAssetByGroup.set(groupId, evaluated.assetId);

      const image = toClientImage(evaluated);
      if (eventId) {
        const reason = image.fallbackReason ?? "模型未返回可用图片。";
        if (image.status === "fallback") await failGenerationEvent(input.sessionId, input.projectId, eventId, `镜头关键帧生成失败：${reason}`, image.errorCode ?? "PROVIDER_REQUEST_FAILED");
        else await completeGenerationEvent(
          input.sessionId,
          input.projectId,
          eventId,
          image.status === "ready" ? "关键帧通过视觉一致性检查。" : image.status === "needs-review" ? "关键帧两次视觉检查未通过，需要人工确认。" : `镜头关键帧生成失败：${reason}`,
          { status: image.status === "ready" ? "completed" : "needs-review", latencyMs: image.latencyMs }
        );
      }
      completedCount += 1;
      await updateGenerationEventProgress(
        input.sessionId,
        input.projectId,
        input.batchEventId,
        completedCount,
        input.targetFrames.length,
        `关键帧批次已完成 ${completedCount} / ${input.targetFrames.length}。`
      );
    });
    const current = await requireOwnedAnonymousProject(input.sessionId, input.projectId);
    const batchData = imageBatchDataFromProject(current.project, input.batchRunId);
    const images = batchData.images;
    const failedShots = batchData.failedShots;
    await updateOwnedAnonymousProject(input.sessionId, input.projectId, {
      workflowSteps: {
        ...(current.project.workflowSteps ?? defaultWorkflow()),
        keyframes: images.some((image) => image.status === "needs-review") ? "needs-review" : images.some((image) => image.status === "fallback") ? "fallback" : "completed"
      }
    });
    await completeGenerationEvent(
      input.sessionId,
      input.projectId,
      input.batchEventId,
      failedShots.length > 0 ? `关键帧批次完成，${failedShots.length} 个镜头需要处理，具体原因见对应镜头日志。` : `关键帧批次完成并通过视觉检查，共 ${images.length} 张。`,
      { status: images.some((image) => image.status === "needs-review") ? "needs-review" : failedShots.length > 0 ? "fallback" : "completed", progressCurrent: images.length, progressTotal: batchData.requestedShots }
    );
    return { images, failedShots, mode: input.mode, requestedShots: input.requestedShots, generatedShots: images.length };
  } catch (error) {
    if (error instanceof Error && error.message === "TASK_POLL_INTERRUPTED") return { images: [], failedShots: [], mode: input.mode, requestedShots: input.requestedShots, generatedShots: 0 };
    if (error instanceof Error && error.message === "SUBMISSION_STATE_UNKNOWN") {
      await blockUnknownSubmission(input.sessionId, input.projectId, input.batchEventId);
      return { images: [], failedShots: [], mode: input.mode, requestedShots: input.requestedShots, generatedShots: 0 };
    }
    await failImageBatch(input, sanitizeApiError(error));
    throw error;
  }
}

async function runContinuityAware<T>(targets: TargetFrame[], worker: (target: TargetFrame) => Promise<T>): Promise<T[]> {
  const groups = new Map<string, TargetFrame[]>();
  for (const target of [...targets].sort((left, right) => left.shot.index - right.shot.index || left.frame.index - right.frame.index)) {
    const key = target.shot.continuityGroupId ?? target.shot.sceneGroupId ?? `shot:${target.shot.id}`;
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }
  const queues = [...groups.values()];
  const output: T[] = [];
  let cursor = 0;
  async function consume() {
    while (cursor < queues.length) {
      const queue = queues[cursor++];
      for (const target of queue ?? []) output.push(await worker(target));
    }
  }
  await Promise.all(Array.from({ length: Math.min(QWEN_FRAME_CONCURRENCY, queues.length) }, consume));
  return output;
}

async function persistKeyframeState(
  input: ImageBatchInput,
  shot: TargetShot,
  frame: ShotFrame,
  result: ShotImageGenerationResult,
  status: "generated" | "text-qa" | "product-qa" | "character-qa" | "scene-qa" | "qa-review"
) {
  await mutateOwnedAnonymousProject(input.sessionId, input.projectId, (project) => {
    const previous = project.keyframes?.find((item) => keyframeIdentity(item.shotId, item.frameId) === keyframeIdentity(shot.id, frame.id));
    if (keepApprovedKeyframe(previous, status)) return project;
    return {
      ...project,
      shots: updateShotFrame(project.shots, shot.id, frame.id, result.assetId, status === "generated" ? "generating" : "qa-review"),
      keyframes: [...(project.keyframes ?? []).filter((item) => keyframeIdentity(item.shotId, item.frameId) !== keyframeIdentity(shot.id, frame.id)), toKeyframeMetadata(result, status)]
    };
  });
}

async function persistEvaluatedKeyframe(input: ImageBatchInput, shot: TargetShot, frame: ShotFrame, image: EvaluatedImage) {
  await mutateOwnedAnonymousProject(input.sessionId, input.projectId, (project) => {
    const previous = project.keyframes?.find((item) => keyframeIdentity(item.shotId, item.frameId) === keyframeIdentity(shot.id, frame.id));
    if (keepApprovedKeyframe(previous, image.status)) return project;
    const versions = archiveSupersededKeyframe(project.keyframeVersions, previous, image.assetId, image.status);
    const qaResults = image.qaResults?.length
      ? [...(project.keyframeQAResults ?? []).filter((item) => keyframeIdentity(item.shotId, item.frameId) !== keyframeIdentity(shot.id, frame.id)), ...image.qaResults]
      : project.keyframeQAResults;
    return {
      ...project,
      keyframeVersions: versions,
      keyframeQAResults: qaResults,
      shots: updateShotFrame(project.shots, shot.id, frame.id, image.assetId, image.status === "fallback" ? "failed" : image.status),
      keyframes: [...(project.keyframes ?? []).filter((item) => keyframeIdentity(item.shotId, item.frameId) !== keyframeIdentity(shot.id, frame.id)), toKeyframeMetadata(image, image.status)]
    };
  });
}

function toKeyframeMetadata(result: ShotImageGenerationResult, status: "generated" | "text-qa" | "product-qa" | "character-qa" | "scene-qa" | "qa-review" | EvaluatedImage["status"]) {
  return {
    shotId: result.shotId,
    ...(result.frameId ? { frameId: result.frameId } : {}),
    ...(result.assetId ? { assetId: result.assetId } : {}),
    ...(!result.fallbackUsed && result.assetId && result.localUrl ? { imageUrl: result.localUrl, localUrl: result.localUrl } : {}),
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    ...(result.requestId ? { requestId: result.requestId } : {}),
    ...(result.cacheStatus ? { cacheStatus: result.cacheStatus } : {}),
    fallbackUsed: result.fallbackUsed,
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    status,
    storageTransition: "PRIVATE_ASSET_V1" as const
  };
}

function keyframeIdentity(shotId: string, frameId?: string) {
  return `${shotId}:${frameId ?? "legacy-frame-0"}`;
}

function updateShotFrame(
  shots: TargetShot[],
  shotId: string,
  frameId: string,
  assetId: string | undefined,
  status: ShotFrame["status"]
) {
  return shots.map((shot) => shot.id !== shotId ? shot : {
    ...shot,
    primaryKeyframeAssetId: assetId ?? (shot.frames ?? []).find((candidate) => candidate.id !== frameId && candidate.assetId && candidate.status === "ready")?.assetId,
    frames: (shot.frames ?? []).map((frame) => frame.id !== frameId ? frame : {
      ...frame,
      assetId,
      status
    })
  });
}

function shotForFrame(shot: TargetShot, frame: ShotFrame): TargetShot {
  const moment = frame.keyframeMoment;
  const frameMoment = moment ? `关键帧时间 ${moment.timestampSec.toFixed(2)} 秒。画面目的：${moment.narrativePurpose}。确定状态：${moment.momentDescription}。人物姿态：${moment.characterPose}；手部：${moment.handState}；视线：${moment.gazeDirection}；产品位置：${moment.productPosition}；机位：${moment.cameraAngle}。与前一帧的连续性：${moment.continuityFromPreviousFrame}。` : "";
  const backgroundMoment = moment ? `人物姿态：${moment.characterPose}；手部状态：${moment.handState}；视线：${moment.gazeDirection}；机位：${moment.cameraAngle}。` : "";
  return {
    ...shot,
    id: `${shot.id}--${frame.id}`,
    visualDescription: `${backgroundMoment}${frame.description}`,
    imagePromptCn: `${frameMoment}\n${frame.imagePromptCn}\n硬性要求：只生成一个冻结瞬间的一张完整全画幅图片。禁止分镜板、网格、拼贴、接触表、前后对比和多面板。`,
    imagePromptEn: `${frame.imagePromptEn}\nHARD CONSTRAINT: Generate exactly one frozen moment as one full-frame image. No storyboard, grid, collage, contact sheet, before/after layout, split screen, or multiple panels.`,
    negativePromptCn: [frame.negativePromptCn, shot.negativePromptCn, "多面板，拼贴，分镜板，网格，接触表，前后对比，分屏，多时刻"].filter(Boolean).join("，"),
    negativePromptEn: [frame.negativePromptEn, shot.negativePromptEn, "multi-panel, collage, storyboard, grid, contact sheet, before-after, split screen, multiple moments"].filter(Boolean).join(", ")
  };
}

async function failImageBatch(input: ImageBatchInput, detail: string) {
  const project = (await requireOwnedAnonymousProject(input.sessionId, input.projectId)).project;
  await Promise.all([...input.shotEvents.entries()].map(async ([frameId, eventId]) => {
    const current = project.generationEvents?.find((event) => event.id === eventId);
    if (!current || !["queued", "running", "qa-review"].includes(current.status)) return;
    const target = input.targetFrames.find((item) => item.frame.id === frameId);
    await failGenerationEvent(input.sessionId, input.projectId, eventId, `镜头 ${target?.shot.index ?? "?"} 第 ${(target?.frame.index ?? 0) + 1} 帧生成中断：${detail}`).catch(() => undefined);
  }));
  await failGenerationEvent(input.sessionId, input.projectId, input.batchEventId, `关键帧批次生成失败：${detail}`).catch(() => undefined);
}

function toClientImage(result: EvaluatedImage) {
  const diagnostic = result.fallbackUsed ? diagnoseQwenImageFallback(result.fallbackReason ?? result.error) : null;
  return {
    shotId: result.shotId,
    frameId: result.frameId,
    assetId: result.assetId,
    imageUrl: result.localUrl || result.imageUrl,
    localUrl: result.localUrl,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    requestId: result.requestId,
    size: result.size,
    cacheStatus: result.cacheStatus,
    fallbackUsed: result.fallbackUsed,
    fallbackReason: result.fallbackReason ?? null,
    referenceUsed: result.referenceUsed ?? false,
    status: result.status,
    errorCode: result.errorCode ?? null,
    qaResult: result.qaResult ?? null,
    diagnostic
  };
}

function imageBatchDataFromProject(project: Awaited<ReturnType<typeof requireOwnedAnonymousProject>>["project"], runId: string) {
  const events = (project.generationEvents ?? [])
    .filter((event) => event.runId === runId && event.action === "生成单帧关键帧" && event.shotId)
  const frameIds = new Set(events.map((event) => event.frameId).filter((id): id is string => Boolean(id)));
  const shotIds = new Set(events.map((event) => event.shotId!));
  const images = (project.keyframes ?? []).filter((frame) => frame.frameId ? frameIds.has(frame.frameId) : shotIds.has(frame.shotId)).map((frame) => {
    const diagnostic = frame.fallbackUsed ? diagnoseQwenImageFallback(frame.fallbackReason) : null;
    const qaResult = project.keyframeQAResults?.filter((item) => item.shotId === frame.shotId && item.frameId === frame.frameId && item.assetId === frame.assetId).sort((a, b) => b.attempt - a.attempt)[0] ?? null;
    return {
      shotId: frame.shotId,
      frameId: frame.frameId,
      assetId: frame.assetId,
      imageUrl: frame.localUrl || frame.imageUrl,
      localUrl: frame.localUrl,
      provider: frame.provider ?? "qwen-image",
      model: frame.model ?? "qwen-image",
      latencyMs: frame.latencyMs ?? 0,
      requestId: frame.requestId,
      cacheStatus: frame.cacheStatus ?? "not-requested",
      fallbackUsed: frame.fallbackUsed,
      fallbackReason: frame.fallbackReason ?? null,
      referenceUsed: Boolean(frame.assetId),
      status: frame.status === "ready" ? "ready" as const : frame.status === "needs-review" ? "needs-review" as const : "fallback" as const,
      qaResult,
      diagnostic
    };
  });
  const failedShots = images.filter((image) => image.fallbackUsed || image.status === "needs-review").map((image) => ({ shotId: image.shotId, fallbackReason: image.status === "needs-review" ? "视觉一致性检查未通过。" : image.fallbackReason, diagnostic: image.diagnostic }));
  return { images, failedShots, generatedShots: images.length, requestedShots: events.length };
}

function findPreviousContinuityAssetId(
  project: Awaited<ReturnType<typeof requireOwnedAnonymousProject>>["project"],
  targetShots: TargetShot[]
) {
  if (targetShots.length !== 1) return undefined;
  const target = targetShots[0];
  const groupId = target?.continuityGroupId ?? target?.sceneGroupId;
  if (!target || !groupId) return undefined;
  const previous = [...project.shots]
    .filter((shot) => shot.index < target.index && (shot.continuityGroupId ?? shot.sceneGroupId) === groupId)
    .sort((a, b) => b.index - a.index)[0];
  if (!previous) return undefined;
  return project.keyframes?.find((frame) => frame.shotId === previous.id && frame.assetId)?.assetId;
}

function defaultWorkflow() {
  return {
    brief: "completed" as const,
    strategy: "completed" as const,
    storyboard: "completed" as const,
    keyframes: "pending" as const,
    heroShot: "pending" as const,
    render: "pending" as const
  };
}
