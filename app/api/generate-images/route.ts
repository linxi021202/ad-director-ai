import { z } from "zod";

import { diagnoseQwenImageFallback } from "../../../lib/api/provider-diagnostics";
import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { getPublicAIStatus } from "../../../lib/config/ai";
import { selectPrimaryProductImage } from "../../../lib/image/productReference";
import { projectStoreErrorResponse } from "../../../lib/projects/api";
import {
  completeGenerationEvent,
  failGenerationEvent,
  startGenerationEvent,
  updateGenerationEventProgress
} from "../../../lib/projects/generationEvents";
import {
  anonymousProjectIdSchema,
  requireOwnedAnonymousProject,
  updateOwnedAnonymousProject
} from "../../../lib/projects/anonymousProjectStore";
import { generateBatchShotImages, selectProviderModel } from "../../../lib/providers/providerRouter";
import { aspectRatioSchema, productImageSchema, storyboardShotSchema } from "../../../lib/schemas/project";
import { getAnonymousApiSession } from "../../../lib/session/api";
import { MAX_SHOT_COUNT, getDefaultHeroShotArrayIndex } from "../../../lib/video/shotConfig";

const requestSchema = z.object({
  projectId: anonymousProjectIdSchema,
  shots: z.array(storyboardShotSchema).min(1).max(12),
  mode: z.enum(["hero-only", "all-shots"]),
  aspectRatio: aspectRatioSchema.optional().default("9:16"),
  productImages: z.array(productImageSchema).max(3).optional()
}).strict();

const batchEventIdSchema = z.string().uuid();
type TargetShot = z.infer<typeof storyboardShotSchema>;
type ImageBatchInput = {
  sessionId: string;
  projectId: string;
  targetShots: TargetShot[];
  aspectRatio: z.infer<typeof aspectRatioSchema>;
  productImage: ReturnType<typeof selectPrimaryProductImage>;
  mode: "hero-only" | "all-shots";
  requestedShots: number;
  batchEventId: string;
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
  maxImagesPerRun: number,
  heroShotId?: string | null
) {
  if (mode === "hero-only") {
    return [shots.find((shot) => shot.id === heroShotId) ?? shots[getDefaultHeroShotArrayIndex(shots.length)] ?? shots[0]];
  }
  return shots.slice(0, Math.min(MAX_SHOT_COUNT, maxImagesPerRun));
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
    activeProjectId = parsed.data.projectId;
    const batchEvent = await startGenerationEvent(session.id, activeProjectId, {
      stage: "keyframes", provider: "qwen-image", action: "生成关键帧批次",
      message: `Qwen-Image 正在生成 ${targetShots.length} 张关键帧。`, progressCurrent: 0, progressTotal: targetShots.length
    });
    batchEventId = batchEvent.id;
    const shotEvents = new Map<string, string>();
    for (const shot of targetShots) {
      const event = await startGenerationEvent(session.id, activeProjectId, {
        stage: "keyframes", provider: "qwen-image", action: "生成单镜头关键帧",
        message: `正在生成镜头 ${shot.index} 关键帧。`, shotId: shot.id, runId: batchEvent.runId
      });
      shotEvents.set(shot.id, event.id);
    }
    const imageRoute = selectProviderModel({ taskType: "image", hasChineseText: true });
    const productImage = selectPrimaryProductImage(owned.project.brief.productImages);
    const batchInput: ImageBatchInput = {
      sessionId: session.id,
      projectId: activeProjectId,
      targetShots,
      aspectRatio: parsed.data.aspectRatio,
      productImage,
      mode: parsed.data.mode,
      requestedShots: parsed.data.shots.length,
      batchEventId: batchEvent.id,
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

    const completed = await executeImageBatch(batchInput);
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

    if (event.status === "running" || event.status === "queued") {
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
  if (imageJobs.has(input.batchEventId)) return;
  const job = executeImageBatch(input)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      imageJobs.delete(input.batchEventId);
    });
  imageJobs.set(input.batchEventId, job);
}

async function executeImageBatch(input: ImageBatchInput) {
  try {
    let completedCount = 0;
    const results = await generateBatchShotImages(input.projectId, input.targetShots, {
      aspectRatio: input.aspectRatio,
      hasChineseText: true,
      sessionId: input.sessionId,
      productImage: input.productImage
    }, async (result) => {
      const image = toClientImage(result);
      const eventId = input.shotEvents.get(image.shotId);
      if (eventId) {
        const reason = image.fallbackReason ?? "模型未返回可用图片。";
        await completeGenerationEvent(
          input.sessionId,
          input.projectId,
          eventId,
          image.fallbackUsed ? `镜头关键帧生成失败：${reason}` : "单镜头关键帧生成完成。",
          { status: image.fallbackUsed ? "fallback" : "completed", latencyMs: image.latencyMs }
        );
      }
      completedCount += 1;
      await updateGenerationEventProgress(
        input.sessionId,
        input.projectId,
        input.batchEventId,
        completedCount,
        input.targetShots.length,
        `关键帧批次已完成 ${completedCount} / ${input.targetShots.length}。`
      );
    });
    const images = results.map(toClientImage);

    const failedShots = images.filter((image) => image.fallbackUsed).map((image) => ({
      shotId: image.shotId,
      fallbackReason: image.fallbackReason ?? "关键帧生成使用了占位图降级。",
      diagnostic: image.diagnostic
    }));
    const current = await requireOwnedAnonymousProject(input.sessionId, input.projectId);
    const currentShotIds = new Set(current.project.shots.map((shot) => shot.id));
    const generatedFrames = images.filter((image) => currentShotIds.has(image.shotId)).map((image) => ({
      shotId: image.shotId,
      ...(image.assetId ? { assetId: image.assetId } : {}),
      ...(image.localUrl ? { imageUrl: image.localUrl, localUrl: image.localUrl } : {}),
      provider: image.provider,
      model: image.model,
      latencyMs: image.latencyMs,
      ...(image.requestId ? { requestId: image.requestId } : {}),
      ...(image.cacheStatus ? { cacheStatus: image.cacheStatus } : {}),
      fallbackUsed: image.fallbackUsed,
      ...(image.fallbackReason ? { fallbackReason: image.fallbackReason } : {}),
      status: image.fallbackUsed ? "fallback" as const : "ready" as const,
      storageTransition: "PRIVATE_ASSET_V1" as const
    }));
    if (generatedFrames.length !== images.length) {
      throw new Error("关键帧生成期间分镜已发生变化，本批结果已停止写入，请重新执行。");
    }
    const generatedShotIds = new Set(generatedFrames.map((frame) => frame.shotId));
    await updateOwnedAnonymousProject(input.sessionId, input.projectId, {
      keyframes: [...(current.project.keyframes ?? []).filter((frame) => !generatedShotIds.has(frame.shotId)), ...generatedFrames],
      workflowSteps: {
        ...(current.project.workflowSteps ?? defaultWorkflow()),
        keyframes: failedShots.length > 0 ? "fallback" : "completed"
      }
    });
    await completeGenerationEvent(
      input.sessionId,
      input.projectId,
      input.batchEventId,
      failedShots.length > 0 ? `关键帧批次完成，${failedShots.length} 个镜头生成失败，具体原因见对应镜头日志。` : `关键帧批次完成，共 ${images.length} 张。`,
      { status: failedShots.length > 0 ? "fallback" : "completed", progressCurrent: images.length, progressTotal: input.targetShots.length }
    );
    return { images, failedShots, mode: input.mode, requestedShots: input.requestedShots, generatedShots: images.length };
  } catch (error) {
    await failImageBatch(input, sanitizeApiError(error));
    throw error;
  }
}

async function failImageBatch(input: ImageBatchInput, detail: string) {
  await Promise.all([...input.shotEvents.entries()].map(async ([shotId, eventId]) => {
    const shot = input.targetShots.find((item) => item.id === shotId);
    await failGenerationEvent(input.sessionId, input.projectId, eventId, `镜头 ${shot?.index ?? "?"} 关键帧生成中断：${detail}`).catch(() => undefined);
  }));
  await failGenerationEvent(input.sessionId, input.projectId, input.batchEventId, `关键帧批次生成失败：${detail}`).catch(() => undefined);
}

function toClientImage(result: Awaited<ReturnType<typeof generateBatchShotImages>>[number]) {
  const diagnostic = result.fallbackUsed ? diagnoseQwenImageFallback(result.fallbackReason ?? result.error) : null;
  return {
    shotId: result.shotId,
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
    diagnostic
  };
}

function imageBatchDataFromProject(project: Awaited<ReturnType<typeof requireOwnedAnonymousProject>>["project"], runId: string) {
  const shotIds = new Set((project.generationEvents ?? [])
    .filter((event) => event.runId === runId && event.action === "生成单镜头关键帧" && event.shotId)
    .map((event) => event.shotId!));
  const images = (project.keyframes ?? []).filter((frame) => shotIds.has(frame.shotId)).map((frame) => {
    const diagnostic = frame.fallbackUsed ? diagnoseQwenImageFallback(frame.fallbackReason) : null;
    return {
      shotId: frame.shotId,
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
      diagnostic
    };
  });
  const failedShots = images.filter((image) => image.fallbackUsed).map((image) => ({ shotId: image.shotId, fallbackReason: image.fallbackReason, diagnostic: image.diagnostic }));
  return { images, failedShots, generatedShots: images.length, requestedShots: shotIds.size };
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
