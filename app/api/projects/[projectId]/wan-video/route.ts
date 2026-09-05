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
  startGenerationEvent
} from "@/lib/projects/generationEvents";
import { wanVideoProvider } from "@/lib/providers/wanVideoProvider";
import { aspectRatioSchema, productImageSchema, type GenerationEvent } from "@/lib/schemas/project";
import { getAnonymousApiSession } from "@/lib/session/api";
import { downloadRemoteVideo } from "@/lib/video/downloadVideo";
import { getWanVideoTaskStatus } from "@/lib/video/wanVideoClient";
import type { WanVideoResult, WanVideoTaskResult } from "@/lib/video/types";

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

    const event = await startGenerationEvent(session.id, projectId, {
      stage: "hero-shot",
      provider: "wan",
      action: "generate-hero-video",
      message: "Wan 2.7 广告视频生成已开始。",
      shotId: parsed.data.shotId,
      progressCurrent: 0,
      progressTotal: 1
    });
    eventId = event.id;

    const result = await wanVideoProvider.generateHeroVideoFromImage?.({
      imageUrl: parsed.data.imageUrl,
      heroImageAssetId: authorization.record.project.keyframes?.find(
        (frame) => frame.shotId === parsed.data.shotId
      )?.assetId,
      productImages: authorization.record.project.brief.productImages ?? parsed.data.productImages,
      prompt: parsed.data.prompt,
      durationSec: parsed.data.durationSec,
      aspectRatio: parsed.data.aspectRatio,
      projectId,
      shotId: parsed.data.shotId,
      sessionId: session.id
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
        shotId: parsed.data.shotId
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
    if (eventId && projectId) {
      await failGenerationEvent(
        session.id,
        projectId,
        eventId,
        "Wan 2.7 视频任务提交异常，请稍后重试。",
        "PROVIDER_REQUEST_FAILED"
      ).catch(() => undefined);
    }
    return response(false, null, null, sanitizeError(error), 500);
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
      shotId: event.shotId ?? authorization.record.project.heroShotId ?? authorization.record.project.shots[0]!.id
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
}) {
  if (!input.result.remoteVideoUrl) {
    return response(false, null, buildTrace(input.result), "Wan 2.7 未返回可下载的视频地址。", 502);
  }

  const download = await downloadRemoteVideo(input.result.remoteVideoUrl);
  if (!download.success || !download.buffer || !download.sizeBytes) {
    const error = download.error ?? "Wan 2.7 视频下载失败。";
    await failGenerationEvent(input.sessionId, input.projectId, input.event.id, error, "ASSET_UPLOAD_FAILED");
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
    { ...buildTrace(input.result), cacheStatus: "cached-private", referenceMode: "first-frame-and-product-references" },
    null,
    200
  );
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
    model: result.model ?? "wan2.7-r2v",
    taskId: result.taskId ?? null,
    requestId: result.requestId ?? null,
    latencyMs: result.latencyMs ?? null,
    capability: "api-available"
  };
}

function classifyProviderError(error: string) {
  if (/quota|allocation|free tier/i.test(error)) return "QUOTA_EXHAUSTED";
  if (/timeout|timed out/i.test(error)) return "PROVIDER_TIMEOUT";
  if (/not configured|key|密钥/i.test(error)) return "NOT_CONFIGURED";
  return "PROVIDER_REQUEST_FAILED";
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
