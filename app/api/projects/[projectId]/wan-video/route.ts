import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readHeroVideoProjectState,
  sanitizeHeroVideoAssetForClient,
  saveHeroVideoAsset
} from "@/lib/heroVideoAsset";
import { authorizeOwnedProject } from "@/lib/projects/api";
import {
  attachGenerationEventProviderTask,
  completeGenerationEvent,
  failGenerationEvent,
  markGenerationEventQAReview,
  startGenerationEvent,
  updateGenerationEventProgress
} from "@/lib/projects/generationEvents";
import { wanVideoProvider } from "@/lib/providers/wanVideoProvider";
import { aspectRatioSchema, productImageSchema, type GenerationEvent } from "@/lib/schemas/project";
import { mutateOwnedAnonymousProject, requireOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import { selectPrimaryProductImage } from "@/lib/image/productReference";
import { shotContainsProduct } from "@/lib/continuity/projectContinuity";
import { selectLockedMasterAssetIds } from "@/lib/continuity/visualMasters";
import { inspectVideo } from "@/lib/visual/visualQA";
import { hasApprovedKeyframeQA } from "@/lib/visual/generationGate";
import { getAnonymousApiSession } from "@/lib/session/api";
import { downloadRemoteVideo } from "@/lib/video/downloadVideo";
import { getWanVideoTaskStatus } from "@/lib/video/wanVideoClient";
import type { WanVideoResult, WanVideoTaskResult } from "@/lib/video/types";
import { selectShotVideoStrategy } from "@/lib/storyboard/shotArchitecture";

const requestSchema = z.object({
  shotId: z.string().min(1),
  imageUrl: z.string().min(1),
  productImages: z.array(productImageSchema).min(1).max(4),
  prompt: z.string().min(20),
  aspectRatio: aspectRatioSchema,
  durationSec: z.number().min(3).max(8).default(5)
});

const eventIdSchema = z.string().uuid();
type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  let eventId: string | null = null;
  let projectId: string | null = null;

  try {
    const authorization = await authorizeOwnedProject(session.id, (await context.params).projectId);
    if (!authorization.authorized) return authorization.response;
    projectId = authorization.projectId;

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return response(false, null, null, "Wan 2.7 生成参数不完整，请确认产品图、关键帧、提示词和项目画幅。", 400);
    }

    const project = authorization.record.project;
    const shot = project.shots.find((item) => item.id === parsed.data.shotId);
    const firstFrameId = shot?.frames?.[0]?.id;
    const lastFrameId = shot?.frames?.at(-1)?.id;
    const keyframe = project.keyframes?.find((frame) => frame.shotId === parsed.data.shotId && (!firstFrameId || frame.frameId === firstFrameId));
    const lastKeyframe = lastFrameId && lastFrameId !== firstFrameId
      ? project.keyframes?.find((frame) => frame.shotId === parsed.data.shotId && frame.frameId === lastFrameId && frame.status === "ready")
      : undefined;
    const approvedQA = [...(project.keyframeQAResults ?? [])]
      .filter((item) => item.shotId === parsed.data.shotId && item.assetId === keyframe?.assetId)
      .sort((left, right) => right.attempt - left.attempt)[0];
    if (!shot || !keyframe?.assetId || !approvedQA?.overallPassed || !hasApprovedKeyframeQA(project, parsed.data.shotId, firstFrameId)) {
      return response(false, null, { errorCode: "KEYFRAME_QA_REQUIRED" }, "KEYFRAME_QA_REQUIRED：主镜头关键帧必须先通过视觉一致性检查。", 409);
    }
    const productImage = selectPrimaryProductImage(project.brief.productImages);
    if (shotContainsProduct(shot) && (!productImage?.assetId || project.productVisualSpec?.sourceAssetId !== productImage.assetId)) {
      return response(false, null, { errorCode: "PRODUCT_REFERENCE_REQUIRED" }, "PRODUCT_REFERENCE_REQUIRED：主镜头缺少当前 Product Master 或其视觉规格。", 409);
    }

    const event = await startGenerationEvent(session.id, projectId, {
      stage: "hero-shot",
      provider: "wan",
      action: "generate-hero-video",
      message: `Wan 2.7 正在提交生成任务：目标 ${parsed.data.durationSec} 秒，画幅 ${parsed.data.aspectRatio}。`,
      shotId: parsed.data.shotId,
      progressCurrent: 0,
      progressTotal: 1
    });
    eventId = event.id;

    const result = await wanVideoProvider.generateHeroVideoFromImage?.({
      imageUrl: parsed.data.imageUrl,
      heroImageAssetId: authorization.record.project.keyframes?.find(
        (frame) => frame.shotId === parsed.data.shotId && (!firstFrameId || frame.frameId === firstFrameId)
      )?.assetId,
      ...(shot && selectShotVideoStrategy(shot) !== "single-clip" && lastKeyframe?.assetId ? { lastImageAssetId: lastKeyframe.assetId } : {}),
      productImages: authorization.record.project.brief.productImages ?? parsed.data.productImages,
      prompt: parsed.data.prompt,
      durationSec: parsed.data.durationSec,
      aspectRatio: parsed.data.aspectRatio,
      projectId,
      shotId: parsed.data.shotId,
      sessionId: session.id,
      assetBaseUrl: resolveAssetBaseUrl(request)
    });

    if (!result || !result.success) {
      const error = result?.error ?? "Wan 2.7 未返回生成结果。";
      await failGenerationEvent(session.id, projectId, eventId, "Wan 2.7 广告视频生成失败：" + error, classifyProviderError(error));
      return response(false, null, result ? buildTrace(result) : null, error, 502);
    }

    if (result.remoteVideoUrl) {
      return finalizeWanVideo({
        sessionId: session.id,
        projectId,
        event,
        result,
        aspectRatio: parsed.data.aspectRatio,
        shotId: parsed.data.shotId,
        assetBaseUrl: resolveAssetBaseUrl(request)
      });
    }

    if (!result.taskId) {
      const error = "Wan 2.7 未返回 task_id 或可下载的视频地址。";
      await failGenerationEvent(session.id, projectId, eventId, error, "PROVIDER_INVALID_RESPONSE");
      return response(false, null, buildTrace(result), error, 502);
    }

    await attachGenerationEventProviderTask(session.id, projectId, eventId, {
      taskId: result.taskId,
      requestId: result.requestId,
      message: "Wan 2.7 任务已提交，正在百炼生成视频。"
    });

    return response(
      true,
      { status: "running", eventId, taskId: result.taskId },
      buildTrace(result),
      null,
      202
    );
  } catch (error) {
    const detail = sanitizeError(error);
    if (eventId && projectId) {
      await failGenerationEvent(
        session.id,
        projectId,
        eventId,
        `Wan 2.7 视频任务提交异常：${detail}`,
        classifyProviderError(detail)
      ).catch(() => undefined);
    }
    return response(false, null, null, detail, 500);
  }
}

export async function GET(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;

  try {
    const authorization = await authorizeOwnedProject(session.id, (await context.params).projectId);
    if (!authorization.authorized) return authorization.response;

    const parsedEventId = eventIdSchema.safeParse(new URL(request.url).searchParams.get("eventId"));
    if (!parsedEventId.success) {
      return response(false, null, null, "缺少有效的 Wan 2.7 任务事件 ID。", 400);
    }

    const event = authorization.record.project.generationEvents?.find((item) => item.id === parsedEventId.data);
    if (!event || event.provider !== "wan" || event.action !== "generate-hero-video") {
      return response(false, null, null, "当前会话中不存在这个 Wan 2.7 生成任务。", 404);
    }

    if (event.status === "completed") {
      const state = await readHeroVideoProjectState(session.id, authorization.projectId);
      if (state.heroVideoAsset) {
        return response(true, {
          status: "completed",
          eventId: event.id,
          asset: sanitizeHeroVideoAssetForClient(state.heroVideoAsset)
        }, null, null, 200);
      }
      return response(false, null, null, "Wan 2.7 任务已完成，但项目视频资产不存在，请重新生成。", 409);
    }
    if (event.status === "qa-review") {
      return response(true, { status: "qa-review", eventId: event.id }, null, null, 202);
    }
    if (event.status === "needs-review") {
      return response(false, { status: "needs-review", eventId: event.id }, null, event.message, 422);
    }

    if (["failed", "cancelled", "blocked", "interrupted"].includes(event.status)) {
      return response(false, null, null, event.message, 409);
    }
    if (!event.providerTaskId) {
      return response(false, null, null, "Wan 2.7 任务尚未取得百炼 task_id，请重新提交。", 409);
    }

    const result = await getWanVideoTaskStatus({
      taskId: event.providerTaskId,
      sessionId: session.id
    });

    if (!result.success) {
      const error = result.error ?? "Wan 2.7 任务状态查询失败。";
      if (result.retryable) {
        await updateGenerationEventProgress(
          session.id,
          authorization.projectId,
          event.id,
          0,
          1,
          `Wan 2.7 任务仍在运行，但本次状态查询失败：${error} 系统将继续查询。`
        );
        return response(false, { status: "running", eventId: event.id, taskId: event.providerTaskId }, buildTrace(result), error, 503);
      }
      await failGenerationEvent(session.id, authorization.projectId, event.id, error, classifyProviderError(error));
      return response(false, null, buildTrace(result), error, 502);
    }

    if (result.status === "running") {
      return response(
        true,
        { status: "running", eventId: event.id, taskId: event.providerTaskId },
        buildTrace(result),
        null,
        202
      );
    }

    if (!result.remoteVideoUrl) {
      const error = "Wan 2.7 任务已完成，但百炼没有返回视频地址。";
      await failGenerationEvent(session.id, authorization.projectId, event.id, error, "PROVIDER_INVALID_RESPONSE");
      return response(false, null, buildTrace(result), error, 502);
    }

    return finalizeWanVideo({
      sessionId: session.id,
      projectId: authorization.projectId,
      event,
      result,
      aspectRatio: authorization.record.project.brief.aspectRatio,
      shotId: event.shotId ?? authorization.record.project.heroShotId ?? authorization.record.project.shots[0]!.id,
      assetBaseUrl: resolveAssetBaseUrl(request)
    });
  } catch (error) {
    return response(false, null, null, sanitizeError(error), 500);
  }
}

async function finalizeWanVideo(input: {
  sessionId: string;
  projectId: string;
  event: GenerationEvent;
  result: WanVideoResult | WanVideoTaskResult;
  aspectRatio: "9:16" | "16:9" | "1:1";
  shotId: string;
  assetBaseUrl?: string;
}) {
  if (!input.result.remoteVideoUrl) {
    return response(false, null, buildTrace(input.result), "Wan 2.7 未返回可下载的视频地址。", 502);
  }

  const current = await requireOwnedAnonymousProject(input.sessionId, input.projectId);
  const shot = current.project.shots.find((item) => item.id === input.shotId);
  if (!shot) return response(false, null, buildTrace(input.result), "当前主镜头已失效，请重新选择。", 409);
  const priorAttempts = (current.project.videoQAResults ?? [])
    .filter((item) => item.generationEventId === input.event.id).length;
  const attempt = Math.min(2, priorAttempts + 1) as 1 | 2;
  const productImage = selectPrimaryProductImage(current.project.brief.productImages);
  await markGenerationEventQAReview(
    input.sessionId,
    input.projectId,
    input.event.id,
    `Wan 2.7 视频已生成，正在执行第 ${attempt} 次视觉一致性检查。`
  );
  await persistVideoQAStage(input.sessionId, input.projectId, shot.id, "split-screen-qa");
  const qaResult = await inspectVideo({
    sessionId: input.sessionId,
    project: current.project,
    shot,
    videoUrl: input.result.remoteVideoUrl,
    productAssetId: shotContainsProduct(shot) ? productImage?.assetId : undefined,
    masterAssetIds: selectLockedMasterAssetIds(current.project, shot),
    attempt,
    generationEventId: input.event.id
  });
  await persistVideoQAStage(input.sessionId, input.projectId, shot.id, "product-qa");
  if ((shot.characterIds ?? []).length) await persistVideoQAStage(input.sessionId, input.projectId, shot.id, "character-qa");
  if (shot.sceneId) await persistVideoQAStage(input.sessionId, input.projectId, shot.id, "scene-qa");
  await persistVideoQAStage(input.sessionId, input.projectId, shot.id, "text-qa");
  await persistVideoQA(input.sessionId, input.projectId, qaResult);

  if (!qaResult.overallPassed) {
    if (attempt === 1) {
      const keyframe = current.project.keyframes?.find((frame) => frame.shotId === shot.id && frame.status === "ready");
      const retry = keyframe?.assetId ? await wanVideoProvider.generateHeroVideoFromImage?.({
        imageUrl: keyframe.localUrl || keyframe.imageUrl || "private-keyframe",
        heroImageAssetId: keyframe.assetId,
        ...(() => {
          const lastFrameId = shot.frames?.at(-1)?.id;
          const last = lastFrameId ? current.project.keyframes?.find((frame) => frame.frameId === lastFrameId && frame.status === "ready") : undefined;
          return selectShotVideoStrategy(shot) !== "single-clip" && last?.assetId ? { lastImageAssetId: last.assetId } : {};
        })(),
        productImages: current.project.brief.productImages,
        prompt: `${shot.videoPromptCn}\n视觉 QA 定向修复：${qaResult.repairPrompt ?? qaResult.issues.join("；")}`,
        durationSec: shot.durationSec,
        aspectRatio: input.aspectRatio,
        projectId: input.projectId,
        shotId: shot.id,
        sessionId: input.sessionId,
        assetBaseUrl: input.assetBaseUrl
      }) : undefined;
      if (!retry || !retry.success) {
        const error = retry?.error ?? "Wan 2.7 视觉修复任务提交失败。";
        await failGenerationEvent(input.sessionId, input.projectId, input.event.id, error, classifyProviderError(error));
        return response(false, null, retry ? buildTrace(retry) : null, error, 502);
      }
      if (retry.remoteVideoUrl) {
        return finalizeWanVideo({ ...input, result: retry });
      }
      if (!retry.taskId) {
        await failGenerationEvent(input.sessionId, input.projectId, input.event.id, "Wan 2.7 视觉修复未返回 task_id。", "PROVIDER_INVALID_RESPONSE");
        return response(false, null, buildTrace(retry), "Wan 2.7 视觉修复未返回 task_id。", 502);
      }
      await attachGenerationEventProviderTask(input.sessionId, input.projectId, input.event.id, {
        taskId: retry.taskId,
        requestId: retry.requestId,
        status: "running",
        message: "首次视觉检查未通过，Wan 2.7 正在执行一次定向修复重试。"
      });
      return response(true, {
        status: "running", qaStatus: "repairing", attempt: 2, eventId: input.event.id, taskId: retry.taskId
      }, { ...buildTrace(retry), qaResult }, null, 202);
    }

    await mutateOwnedAnonymousProject(input.sessionId, input.projectId, (project) => ({
      ...project,
      heroVideo: {
        shotId: shot.id,
        source: "wan-api",
        status: "needs-review",
        storageTransition: "PRIVATE_ASSET_V1"
      },
      workflowSteps: { ...(project.workflowSteps ?? defaultWorkflow()), heroShot: "needs-review", render: "blocked" }
    }));
    await completeGenerationEvent(
      input.sessionId,
      input.projectId,
      input.event.id,
      "Wan 2.7 视频两次视觉一致性检查未通过，需要人工确认，已阻止进入最终合成。",
      { status: "needs-review", latencyMs: Date.now() - input.event.startedAt, progressCurrent: 1, progressTotal: 1 }
    );
    return response(false, { status: "needs-review", eventId: input.event.id, qaResult }, buildTrace(input.result), "视频一致性检查未通过。", 422);
  }

  const download = await downloadRemoteVideo(input.result.remoteVideoUrl);
  if (!download.success || !download.buffer || !download.sizeBytes) {
    const error = download.error ?? "Wan 2.7 视频下载失败。";
    await failGenerationEvent(
      input.sessionId,
      input.projectId,
      input.event.id,
      error,
      /VIDEO_DOWNLOAD_TIMEOUT/i.test(error) ? "PROVIDER_TIMEOUT" : "ASSET_UPLOAD_FAILED"
    );
    return response(false, null, buildTrace(input.result), error, 502);
  }

  const saved = await saveHeroVideoAsset({
    sessionId: input.sessionId,
    projectId: input.projectId,
    shotId: input.shotId,
    aspectRatio: input.aspectRatio,
    fileName: "wan-2.7-hero-shot.mp4",
    mimeType: "video/mp4",
    sizeBytes: download.sizeBytes,
    buffer: download.buffer,
    source: "wan-api"
  });

  if (!saved.success) {
    await failGenerationEvent(input.sessionId, input.projectId, input.event.id, saved.error, "ASSET_VALIDATION_FAILED");
    return response(false, null, buildTrace(input.result), saved.error, saved.status);
  }

  await mutateOwnedAnonymousProject(input.sessionId, input.projectId, (project) => ({
    ...project,
    heroVideo: project.heroVideo ? { ...project.heroVideo, status: "ready" } : project.heroVideo,
    videoQAResults: [...(project.videoQAResults ?? []).filter((item) => item.id !== qaResult.id), qaResult],
    workflowSteps: { ...(project.workflowSteps ?? defaultWorkflow()), heroShot: "completed", render: "pending" }
  }));

  await completeGenerationEvent(
    input.sessionId,
    input.projectId,
    input.event.id,
    "Wan 2.7 广告视频已生成并保存到项目私有资产。",
    {
      latencyMs: Date.now() - input.event.startedAt,
      progressCurrent: 1,
      progressTotal: 1
    }
  );

  return response(
    true,
    { status: "completed", eventId: input.event.id, asset: sanitizeHeroVideoAssetForClient(saved.asset) },
    { ...buildTrace(input.result), cacheStatus: "cached-private", referenceMode: "single-approved-keyframe-i2v", qaResult },
    null,
    200
  );
}

async function persistVideoQAStage(sessionId: string, projectId: string, shotId: string, status: string) {
  await mutateOwnedAnonymousProject(sessionId, projectId, (project) => ({
    ...project,
    heroVideo: {
      ...(project.heroVideo ?? { shotId, source: "wan-api", storageTransition: "PRIVATE_ASSET_V1" as const }),
      shotId,
      status
    }
  }));
}

async function persistVideoQA(
  sessionId: string,
  projectId: string,
  qaResult: Awaited<ReturnType<typeof inspectVideo>>
) {
  await mutateOwnedAnonymousProject(sessionId, projectId, (project) => ({
    ...project,
    videoQAResults: [...(project.videoQAResults ?? []).filter((item) => item.id !== qaResult.id), qaResult],
    heroVideo: {
      shotId: qaResult.shotId,
      source: "wan-api",
      status: "qa-review",
      storageTransition: "PRIVATE_ASSET_V1"
    },
    workflowSteps: { ...(project.workflowSteps ?? defaultWorkflow()), heroShot: "qa-review" }
  }));
}

function defaultWorkflow() {
  return {
    brief: "completed" as const,
    strategy: "completed" as const,
    storyboard: "completed" as const,
    keyframes: "completed" as const,
    heroShot: "pending" as const,
    render: "pending" as const
  };
}

function buildTrace(result: {
  provider: string;
  model?: string;
  taskId?: string;
  requestId?: string;
  latencyMs?: number;
}) {
  return {
    provider: result.provider,
    model: result.model ?? "wan2.7-i2v",
    taskId: result.taskId ?? null,
    requestId: result.requestId ?? null,
    latencyMs: result.latencyMs ?? null,
    capability: "api-available"
  };
}

function classifyProviderError(error: string) {
  if (/WAN_SUBMIT_TIMEOUT/i.test(error)) return "PROVIDER_SUBMIT_TIMEOUT";
  if (/WAN_STATUS_TIMEOUT/i.test(error)) return "PROVIDER_STATUS_TIMEOUT";
  if (/actual duration|实际时长|VIDEO_DURATION/i.test(error)) return "VIDEO_DURATION_OUT_OF_TOLERANCE";
  if (/quota|allocation|free tier/i.test(error)) return "QUOTA_EXHAUSTED";
  if (/timeout|timed out/i.test(error)) return "PROVIDER_TIMEOUT";
  if (/not configured|key|密钥/i.test(error)) return "NOT_CONFIGURED";
  return "PROVIDER_REQUEST_FAILED";
}

function resolveAssetBaseUrl(request: Request) {
  const configured = process.env.APP_PUBLIC_URL?.trim();
  if (configured) return configured;
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return railwayDomain ? `https://${railwayDomain}` : new URL(request.url).origin;
}

function response(success: boolean, data: unknown, trace: unknown, error: string | null, status: number) {
  return NextResponse.json(
    { success, data, trace, fallbackUsed: false, fallbackReason: null, error },
    { status }
  );
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-***")
    .slice(0, 300);
}
