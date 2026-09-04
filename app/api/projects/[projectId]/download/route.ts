import "server-only";

import { NextResponse } from "next/server";

import { getPrivateAsset } from "@/lib/assets/assetStore";
import { serveProjectAsset } from "@/lib/assets/http";
import { authorizeOwnedProject } from "@/lib/projects/api";
import { getAnonymousApiSession } from "@/lib/session/api";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  const authorization = await authorizeOwnedProject(
    session.id,
    (await context.params).projectId
  );
  if (!authorization.authorized) return authorization.response;

  const assetId = authorization.record.project.finalVideoAssetId;
  const asset = assetId
    ? await getPrivateAsset(session.id, authorization.projectId, assetId)
    : null;
  if (!asset || asset.kind !== "final-video") {
    return NextResponse.json({
      success: false,
      data: null,
      trace: { route: "download-final-video" },
      fallbackUsed: false,
      fallbackReason: null,
      error: "最终 MP4 尚未生成，无法下载。"
    }, { status: 404 });
  }

  try {
    return await serveProjectAsset(request, asset, { download: true });
  } catch {
    return NextResponse.json({
      success: false,
      data: null,
      trace: { route: "download-final-video" },
      fallbackUsed: false,
      fallbackReason: null,
      error: "最终 MP4 文件不可用，请重新生成。"
    }, { status: 404 });
  }
}
