import "server-only";

import { NextResponse } from "next/server";

import {
  deleteHeroVideoAsset,
  heroVideoFileExists,
  readHeroVideoProjectState,
  safeSegment,
  sanitizeHeroVideoAssetForClient,
  saveHeroVideoAsset
} from "@/lib/heroVideoAsset";
import { authorizeOwnedProject } from "@/lib/projects/api";
import {
  appendGenerationEvent,
  completeGenerationEvent,
  failGenerationEvent,
  startGenerationEvent
} from "@/lib/projects/generationEvents";
import { getHappyHorseCapability } from "@/lib/providers/happyHorseCapability";
import { aspectRatioSchema } from "@/lib/schemas/project";
import { getAnonymousApiSession } from "@/lib/session/api";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  const authorization = await authorizeOwnedProject(session.id, (await context.params).projectId);
  if (!authorization.authorized) return authorization.response;

  const state = await readHeroVideoProjectState(session.id, authorization.projectId);
  const exists = await heroVideoFileExists(session.id, state.heroVideoAsset);
  return NextResponse.json({
    success: true,
    data: {
      exists,
      asset: exists ? sanitizeHeroVideoAssetForClient(state.heroVideoAsset) : null,
      publicUrl: exists ? state.heroVideoAsset?.publicUrl ?? null : null,
      shotId: state.heroShotId,
      capability: getHappyHorseCapability(true).capability
    },
    trace: null,
    fallbackUsed: false,
    fallbackReason: null,
    error: null
  });
}

export async function POST(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  const authorization = await authorizeOwnedProject(session.id, (await context.params).projectId);
  if (!authorization.authorized) return authorization.response;

  let eventId: string | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const shotId = safeSegment(String(formData.get("shotId") ?? ""), "shot");
    const aspectRatioInput = aspectRatioSchema.safeParse(String(formData.get("aspectRatio") ?? "9:16"));
    if (!(file instanceof File)) return response(false, null, "未收到广告视频文件。", 400);
    if (!aspectRatioInput.success) return response(false, null, "项目画幅参数无效。", 400);

    const event = await startGenerationEvent(session.id, authorization.projectId, {
      stage: "hero-shot",
      provider: "happyhorse",
      action: "manual-import",
      message: "完整广告视频开始手动导入。",
      shotId,
      progressCurrent: 0,
      progressTotal: 1
    });
    eventId = event.id;

    const result = await saveHeroVideoAsset({
      sessionId: session.id,
      projectId: authorization.projectId,
      shotId,
      aspectRatio: aspectRatioInput.data,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      buffer: Buffer.from(await file.arrayBuffer())
    });
    if (!result.success) {
      await failGenerationEvent(
        session.id,
        authorization.projectId,
        eventId,
        "广告视频校验失败：" + result.error,
        "ASSET_VALIDATION_FAILED"
      );
      return response(false, null, result.error, result.status);
    }

    await completeGenerationEvent(
      session.id,
      authorization.projectId,
      eventId,
      "完整广告视频已导入并保存到项目私有资产。",
      { progressCurrent: 1, progressTotal: 1 }
    );
    return response(true, { asset: sanitizeHeroVideoAssetForClient(result.asset) }, null, 201);
  } catch {
    if (eventId) {
      await failGenerationEvent(
        session.id,
        authorization.projectId,
        eventId,
        "广告视频上传失败，请重新选择 MP4 文件。",
        "ASSET_UPLOAD_FAILED"
      ).catch(() => undefined);
    }
    return response(false, null, "广告视频上传失败，请重新选择 MP4 文件。", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  const authorization = await authorizeOwnedProject(session.id, (await context.params).projectId);
  if (!authorization.authorized) return authorization.response;

  await deleteHeroVideoAsset(session.id, authorization.projectId);
  await appendGenerationEvent(session.id, authorization.projectId, {
    stage: "hero-shot",
    provider: "happyhorse",
    action: "await-manual-import",
    status: "blocked",
    message: "广告视频已移除，等待重新生成或手动导入。"
  });
  return response(true, { deleted: true, capability: getHappyHorseCapability(true).capability }, null, 200);
}

function response(success: boolean, data: unknown, error: string | null, status: number) {
  return NextResponse.json(
    { success, data, trace: null, fallbackUsed: false, fallbackReason: null, error },
    { status }
  );
}
