import "server-only";

import { NextResponse } from "next/server";

import {
  createPrivateAsset,
  deletePrivateAsset,
  getPrivateAsset,
  toPublicProjectAsset
} from "@/lib/assets/assetStore";
import { hasSupportedAudioSignature } from "@/lib/assets/media";
import { authorizeOwnedProject } from "@/lib/projects/api";
import { updateOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import {
  completeGenerationEvent,
  failGenerationEvent,
  startGenerationEvent
} from "@/lib/projects/generationEvents";
import { getAnonymousApiSession } from "@/lib/session/api";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const SUPPORTED_AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac"] as const;

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const authorization = await authorizeOwnedProject(sessionResult.session.id, (await context.params).projectId);
  if (!authorization.authorized) return authorization.response;
  const assetId = authorization.record.project.narrationAssetId;
  const asset = assetId
    ? await getPrivateAsset(sessionResult.session.id, authorization.projectId, assetId)
    : null;
  return json(true, {
    exists: Boolean(asset),
    asset: asset ? toPublicProjectAsset(asset) : null
  }, null, 200);
}

export async function POST(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  const authorization = await authorizeOwnedProject(session.id, (await context.params).projectId);
  if (!authorization.authorized) return authorization.response;

  let eventId: string | null = null;
  try {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return json(false, null, "请选择旁白音频文件。", 400);

    const event = await startGenerationEvent(session.id, authorization.projectId, {
      stage: "narration",
      provider: "system",
      action: "upload-narration",
      message: "旁白音频开始上传。",
      progressCurrent: 0,
      progressTotal: 1
    });
    eventId = event.id;

    if (!SUPPORTED_AUDIO_TYPES.includes(file.type as (typeof SUPPORTED_AUDIO_TYPES)[number])) {
      await failGenerationEvent(session.id, authorization.projectId, eventId, "旁白格式校验失败。", "ASSET_VALIDATION_FAILED");
      return json(false, null, "旁白仅支持 MP3、WAV、M4A 或 AAC。", 400);
    }
    if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
      await failGenerationEvent(session.id, authorization.projectId, eventId, "旁白文件大小校验失败。", "ASSET_VALIDATION_FAILED");
      return json(false, null, "旁白音频不能为空且不能超过 20MB。", 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasSupportedAudioSignature(bytes, file.type)) {
      await failGenerationEvent(session.id, authorization.projectId, eventId, "旁白文件签名校验失败。", "ASSET_VALIDATION_FAILED");
      return json(false, null, "旁白文件内容与声明格式不一致。", 400);
    }

    const previousAssetId = authorization.record.project.narrationAssetId;
    const asset = await createPrivateAsset(session.id, authorization.projectId, {
      kind: "narration-audio",
      source: "user-upload",
      fileName: file.name,
      mimeType: file.type,
      bytes
    });
    try {
      await updateOwnedAnonymousProject(session.id, authorization.projectId, { narrationAssetId: asset.id });
    } catch (error) {
      await deletePrivateAsset(session.id, authorization.projectId, asset.id);
      throw error;
    }
    if (previousAssetId && previousAssetId !== asset.id) {
      await deletePrivateAsset(session.id, authorization.projectId, previousAssetId).catch(() => undefined);
    }

    await completeGenerationEvent(
      session.id,
      authorization.projectId,
      eventId,
      "旁白音频已上传并保存到项目私有资产。",
      { progressCurrent: 1, progressTotal: 1 }
    );
    return json(true, { exists: true, asset: toPublicProjectAsset(asset) }, null, 201);
  } catch {
    if (eventId) {
      await failGenerationEvent(
        session.id,
        authorization.projectId,
        eventId,
        "旁白音频私有保存失败，请重新上传。",
        "ASSET_UPLOAD_FAILED"
      ).catch(() => undefined);
    }
    return json(false, null, "旁白音频私有保存失败，请重新上传。", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  const authorization = await authorizeOwnedProject(session.id, (await context.params).projectId);
  if (!authorization.authorized) return authorization.response;
  const assetId = authorization.record.project.narrationAssetId;
  await updateOwnedAnonymousProject(session.id, authorization.projectId, { narrationAssetId: null });
  if (assetId) await deletePrivateAsset(session.id, authorization.projectId, assetId);
  return json(true, { exists: false, asset: null }, null, 200);
}

function json(success: boolean, data: unknown, error: string | null, status: number) {
  return NextResponse.json({
    success,
    data,
    trace: { route: "project-narration" },
    fallbackUsed: false,
    fallbackReason: null,
    error
  }, { status });
}
