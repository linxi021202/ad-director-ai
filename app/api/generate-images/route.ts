import { z } from "zod";

import { diagnoseQwenImageFallback } from "../../../lib/api/provider-diagnostics";
import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { getPublicAIStatus } from "../../../lib/config/ai";
import { selectPrimaryProductImage } from "../../../lib/image/productReference";
import { projectStoreErrorResponse } from "../../../lib/projects/api";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent, updateGenerationEventProgress } from "../../../lib/projects/generationEvents";
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
    const results = await generateBatchShotImages(parsed.data.projectId, targetShots, {
      aspectRatio: parsed.data.aspectRatio,
      hasChineseText: true,
      sessionId: session.id,
      productImage
    });

    const images = results.map((result) => {
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
    });    let completedCount = 0;
    for (const image of images) {
      const eventId = shotEvents.get(image.shotId);
      if (eventId) {
        await completeGenerationEvent(session.id, activeProjectId, eventId,
          image.fallbackUsed ? "关键帧生成失败，已使用本地占位图。" : "单镜头关键帧生成完成。",
          { status: image.fallbackUsed ? "fallback" : "completed", latencyMs: image.latencyMs }
        );
      }
      completedCount += 1;
      await updateGenerationEventProgress(session.id, activeProjectId, batchEvent.id, completedCount, targetShots.length, `关键帧批次已完成 ${completedCount} / ${targetShots.length}。`);
    }

    const failedShots = images.filter((image) => image.fallbackUsed).map((image) => ({
      shotId: image.shotId,
      fallbackReason: image.fallbackReason ?? "关键帧生成使用了占位图降级。",
      diagnostic: image.diagnostic
    }));

    const current = await requireOwnedAnonymousProject(session.id, parsed.data.projectId);
    const generatedFrames = images.map((image) => ({
      shotId: image.shotId,
      ...(image.assetId ? { assetId: image.assetId } : {}),
      ...(image.localUrl ? { imageUrl: image.localUrl } : {}),
      ...(image.localUrl ? { localUrl: image.localUrl } : {}),
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
    const generatedShotIds = new Set(generatedFrames.map((frame) => frame.shotId));
    const keyframes = [
      ...(current.project.keyframes ?? []).filter((frame) => !generatedShotIds.has(frame.shotId)),
      ...generatedFrames
    ];
    await updateOwnedAnonymousProject(session.id, parsed.data.projectId, {
      keyframes,
      workflowSteps: {
        ...(current.project.workflowSteps ?? defaultWorkflow()),
        keyframes: failedShots.length > 0 ? "fallback" : "completed"
      }
    });    await completeGenerationEvent(session.id, activeProjectId, batchEvent.id,
      failedShots.length > 0 ? `关键帧批次完成，${failedShots.length} 个镜头使用降级图。` : `关键帧批次完成，共 ${images.length} 张。`,
      { status: failedShots.length > 0 ? "fallback" : "completed", progressCurrent: images.length, progressTotal: targetShots.length }
    );


    return apiJson({
      success: true,
      data: {
        images,
        failedShots,
        mode: parsed.data.mode,
        requestedShots: parsed.data.shots.length,
        generatedShots: images.length
      },
      trace: {
        route: "generate-images",
        taskType: "image",
        mode: parsed.data.mode,
        provider: imageRoute.provider,
        model: imageRoute.model,
        maxImagesPerRun,
        productReferenceRequested: Boolean(productImage),
        productReferenceUsed: images.some((image) => image.referenceUsed),
        generatedShotIds: images.map((image) => image.shotId)
      },
      fallbackUsed: failedShots.length > 0,
      fallbackReason: failedShots.length > 0 ? `${failedShots.length} 个镜头使用了关键帧降级。` : null,
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