import "server-only";

import { requireApiUser } from "@/lib/auth/api";

import { NextResponse } from "next/server";
import { z } from "zod";

import { sanitizeHeroVideoAssetForClient, safeSegment, saveHeroVideoAsset } from "@/lib/heroVideoAsset";
import { happyHorseVideoProvider } from "@/lib/providers/happyHorseVideoProvider";
import { aspectRatioSchema, productImageSchema } from "@/lib/schemas/project";
import { downloadRemoteVideo } from "@/lib/video/downloadVideo";

const requestSchema = z.object({
  shotId: z.string().min(1),
  imageUrl: z.string().min(1),
  productImages: z.array(productImageSchema).min(1).max(3),
  prompt: z.string().min(20),
  aspectRatio: aspectRatioSchema,
  durationSec: z.number().min(3).max(5).default(5)
});

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  try {
    const projectId = safeSegment((await context.params).projectId, "project");
    const parsed = requestSchema.safeParse(await request.json());

    if (!parsed.success) {
      return response(
        false,
        null,
        null,
        "HappyHorse 多参考图请求参数不完整。请确认已上传真实产品图，并已生成当前主镜头关键帧。",
        400
      );
    }

    const sessionId = authResult.user.id;
    const result = await happyHorseVideoProvider.generateHeroVideoFromImage?.({
      imageUrl: parsed.data.imageUrl,
      productImages: parsed.data.productImages,
      prompt: parsed.data.prompt,
      durationSec: parsed.data.durationSec,
      aspectRatio: parsed.data.aspectRatio,
      projectId,
      shotId: parsed.data.shotId,
      sessionId
    });

    if (!result || !result.success) {
      return response(
        false,
        null,
        result ? buildTrace(result) : null,
        result?.error ?? "HappyHorse Provider 未返回结果。",
        502
      );
    }

    if (!result.remoteVideoUrl) {
      return response(false, null, buildTrace(result), "HappyHorse 未返回可下载的视频地址。", 502);
    }

    const download = await downloadRemoteVideo(result.remoteVideoUrl);
    if (!download.success || !download.buffer || !download.sizeBytes) {
      return response(false, null, buildTrace(result), download.error ?? "HappyHorse 视频下载失败。", 502);
    }

    const saved = await saveHeroVideoAsset({
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
      return response(false, null, buildTrace(result), saved.error, saved.status);
    }

    return response(
      true,
      { asset: sanitizeHeroVideoAssetForClient(saved.asset) },
      { ...buildTrace(result), cacheStatus: "cached-local", referenceMode: "product-and-hero-keyframe" },
      null,
      200
    );
  } catch (error) {
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
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-***");
}
