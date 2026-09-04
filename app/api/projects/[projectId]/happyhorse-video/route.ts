import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getAnonymousApiSession } from "@/lib/session/api";
import { authorizeOwnedProject } from "@/lib/projects/api";
import {
  completeGenerationEvent,
  failGenerationEvent,
  startGenerationEvent
} from "@/lib/projects/generationEvents";
import { sanitizeHeroVideoAssetForClient, saveHeroVideoAsset } from "@/lib/heroVideoAsset";
import { happyHorseVideoProvider } from "@/lib/providers/happyHorseVideoProvider";
import { aspectRatioSchema, productImageSchema } from "@/lib/schemas/project";
import { downloadRemoteVideo } from "@/lib/video/downloadVideo";

const requestSchema = z.object({
  shotId: z.string().min(1),
  imageUrl: z.string().min(1),
  productImages: z.array(productImageSchema).min(1).max(3),
  prompt: z.string().min(20),
  aspectRatio: aspectRatioSchema,
  durationSec: z.number().min(3).max(8).default(5)
});

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
      return response(false, null, null, "主镜头生成参数不完整，请确认产品图、关键帧、提示词和项目画幅。", 400);
    }

    const event = await startGenerationEvent(session.id, projectId, {
      stage: "hero-shot",
      provider: "happyhorse",
      action: "generate-hero-video",
      message: "HappyHorse 主镜头视频生成已开始。",
      shotId: parsed.data.shotId,
      progressCurrent: 0,
      progressTotal: 1
    });
    eventId = event.id;

    const result = await happyHorseVideoProvider.generateHeroVideoFromImage?.({
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
      const error = result?.error ?? "HappyHorse 未返回生成结果。";
      await failGenerationEvent(
        session.id,
        projectId,
        eventId,
        "HappyHorse 主镜头生成失败：" + error,
        classifyProviderError(error)
      );
      return response(false, null, result ? buildTrace(result) : null, error, 502);
    }

    if (!result.remoteVideoUrl) {
      const error = "HappyHorse 未返回可下载的视频地址。";
      await failGenerationEvent(session.id, projectId, eventId, error, "PROVIDER_INVALID_RESPONSE");
      return response(false, null, buildTrace(result), error, 502);
    }

    const download = await downloadRemoteVideo(result.remoteVideoUrl);
    if (!download.success || !download.buffer || !download.sizeBytes) {
      const error = download.error ?? "HappyHorse 视频下载失败。";
      await failGenerationEvent(session.id, projectId, eventId, error, "ASSET_UPLOAD_FAILED");
      return response(false, null, buildTrace(result), error, 502);
    }

    const saved = await saveHeroVideoAsset({
      sessionId: session.id,
      projectId,
      shotId: parsed.data.shotId,
      aspectRatio: parsed.data.aspectRatio,
      fileName: "happyhorse-hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: download.sizeBytes,
      buffer: download.buffer,
      source: "happyhorse-api"
    });

    if (!saved.success) {
      await failGenerationEvent(session.id, projectId, eventId, saved.error, "ASSET_VALIDATION_FAILED");
      return response(false, null, buildTrace(result), saved.error, saved.status);
    }

    await completeGenerationEvent(
      session.id,
      projectId,
      eventId,
      "HappyHorse 主镜头视频已生成并保存到项目私有资产。",
      {
        latencyMs: "latencyMs" in result ? result.latencyMs : undefined,
        progressCurrent: 1,
        progressTotal: 1
      }
    );

    return response(
      true,
      { asset: sanitizeHeroVideoAssetForClient(saved.asset) },
      { ...buildTrace(result), cacheStatus: "cached-private", referenceMode: "product-and-hero-keyframe" },
      null,
      200
    );
  } catch (error) {
    if (eventId && projectId) {
      await failGenerationEvent(
        session.id,
        projectId,
        eventId,
        "HappyHorse 主镜头生成异常，请稍后重试。",
        "PROVIDER_REQUEST_FAILED"
      ).catch(() => undefined);
    }
    return response(false, null, null, sanitizeError(error), 500);
  }
}

type ProviderResult = Awaited<ReturnType<NonNullable<typeof happyHorseVideoProvider.generateHeroVideoFromImage>>>;

function buildTrace(result: ProviderResult) {
  return {
    provider: result.provider,
    model: "model" in result ? result.model : "happyhorse-1.0-r2v",
    taskId: "taskId" in result ? result.taskId ?? null : null,
    requestId: "requestId" in result ? result.requestId ?? null : null,
    latencyMs: "latencyMs" in result ? result.latencyMs : null,
    capability: "capability" in result ? result.capability : "api-available"
  };
}

function classifyProviderError(error: string) {
  if (/quota|allocation|free tier/i.test(error)) return "QUOTA_EXHAUSTED";
  if (/timeout|timed out/i.test(error)) return "PROVIDER_TIMEOUT";
  if (/not configured|key/i.test(error)) return "NOT_CONFIGURED";
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
