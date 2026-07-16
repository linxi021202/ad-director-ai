import "server-only";

import { requireApiUser } from "@/lib/auth/api";

import { NextResponse } from "next/server";
import { getHappyHorseCapability } from "@/lib/providers/happyHorseCapability";
import { aspectRatioSchema } from "@/lib/schemas/project";
import {
  deleteHeroVideoAsset,
  heroVideoFileExists,
  readHeroVideoProjectState,
  safeSegment,
  sanitizeHeroVideoAssetForClient,
  saveHeroVideoAsset
} from "@/lib/heroVideoAsset";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  const projectId = await getProjectId(context);
  const state = await readHeroVideoProjectState(projectId);
  const exists = await heroVideoFileExists(state.heroVideoAsset);
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
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  try {
    const projectId = await getProjectId(context);
    const formData = await request.formData();
    const file = formData.get("file");
    const shotId = safeSegment(String(formData.get("shotId") ?? ""), "shot");
    const aspectRatioInput = aspectRatioSchema.safeParse(String(formData.get("aspectRatio") ?? "9:16"));

    if (!(file instanceof File)) return response(false, null, "未收到主镜头视频文件。", 400);
    if (!aspectRatioInput.success) return response(false, null, "项目画幅参数无效。", 400);

    const result = await saveHeroVideoAsset({
      projectId,
      shotId,
      aspectRatio: aspectRatioInput.data,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      buffer: Buffer.from(await file.arrayBuffer())
    });

    if (!result.success) return response(false, null, result.error, result.status);
    return response(true, { asset: sanitizeHeroVideoAssetForClient(result.asset) }, null, 200);
  } catch {
    return response(false, null, "主镜头视频上传失败，请重新选择 MP4 文件。", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  const projectId = await getProjectId(context);
  await deleteHeroVideoAsset(projectId);
  return response(true, { deleted: true, capability: getHappyHorseCapability(true).capability }, null, 200);
}

async function getProjectId(context: RouteContext) {
  const params = await context.params;
  return safeSegment(params.projectId, "project");
}

function response(success: boolean, data: unknown, error: string | null, status: number) {
  return NextResponse.json({ success, data, trace: null, fallbackUsed: false, fallbackReason: null, error }, { status });
}

