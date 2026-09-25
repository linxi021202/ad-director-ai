import { z } from "zod";

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
        message: `正在生成镜头 ${shot.index} 的第 ${frame.index + 1} 帧。`, shotId: shot.id, frameId: frame.id, runId: batchEvent.runId
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

    if (imageRoute.provider === "qwenImageProvider" && targetShots.length > 1) {
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
      return apiJson({
        success: true,
        data: {
          status: "running",
          eventId: event.id,
          generatedShots: event.progressCurrent ?? 0,
          requestedShots: event.progressTotal ?? 1,
          images: [],
          failedShots: []
        },
        trace: { route: "generate-images", stage: "batch-running" },
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
      const onModelAttempt = eventId ? async (attempt: QwenModelAttempt) => {
        await upsertModelCallLog(input.sessionId, {
          kind: "call", taskId: eventId, jobId: input.batchRunId, projectId: input.projectId,
          stage: "keyframes", provider: "qwen-image", model: attempt.model, mode: attempt.mode,
          shotId: shot.id, frameId: frame.id, attempt: attempt.attempt, status: attempt.status,
          startedAt: attempt.startedAt, completedAt: attempt.completedAt,
          durationMs: Math.max(0, attempt.completedAt - attempt.startedAt),
          errorCode: attempt.errorCode, errorSummary: attempt.error, providerErrorCode: attempt.providerErrorCode,
          httpStatus: attempt.httpStatus, providerRequestId: attempt.requestId, providerTaskId: attempt.taskId,
          referenceImageCount: attempt.referenceCount, referenceImagesIncluded: attempt.referenceCount > 0,
          requestOptions: { size: attempt.size, referenceCount: attempt.referenceCount, endpointMode: "dashscope-sync", promptExtend: attempt.promptExtend, watermark: attempt.watermark },
          ...(attempt.assetId ? { outputAssetIds: [attempt.assetId] } : {})
        });
      } : undefined;
      let result: ShotImageGenerationResult = { ...await generateShotImage(input.projectId, frameShot, {
        aspectRatio: input.aspectRatio,
        hasChineseText: true,
        sessionId: input.sessionId,
        productImage: input.productImage,
        productImages: references.productImages,
        productVisualSpec: input.productVisualSpec,
        masterReferenceAssetIds: references.masterReferenceAssetIds,
        continuityImageAssetId: groupId ? previousAssetByGroup.get(groupId) : undefined,
        onModelAttempt
      }), shotId: shot.id, frameId: frame.id };
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
    const images = results.map(toClientImage);

    const failedShots = images.filter((image) => image.status !== "ready").map((image) => ({
      shotId: image.shotId,
      fallbackReason: image.status === "needs-review" ? "视觉一致性检查未通过，已停止自动进入视频生成。" : image.fallbackReason ?? "关键帧生成使用了占位图降级。",
      diagnostic: image.diagnostic
    }));
    const current = await requireOwnedAnonymousProject(input.sessionId, input.projectId);
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
      { status: images.some((image) => image.status === "needs-review") ? "needs-review" : failedShots.length > 0 ? "fallback" : "completed", progressCurrent: images.length, progressTotal: input.targetFrames.length }
    );
    return { images, failedShots, mode: input.mode, requestedShots: input.requestedShots, generatedShots: images.length };
  } catch (error) {
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
    ...(result.localUrl ? { imageUrl: result.localUrl, localUrl: result.localUrl } : {}),
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
    primaryKeyframeAssetId: shot.primaryKeyframeAssetId ?? assetId,
    frames: (shot.frames ?? []).map((frame) => frame.id !== frameId ? frame : {
      ...frame,
      ...(assetId ? { assetId } : {}),
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
