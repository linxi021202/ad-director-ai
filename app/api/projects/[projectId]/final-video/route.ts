import "server-only";

import { NextResponse } from "next/server";

import {
  assertPrivateAssetReadable,
  getProjectAssetUrl,
  getPrivateAsset
} from "@/lib/assets/assetStore";
import { authorizeOwnedProject } from "@/lib/projects/api";
import { getProjectRenderState } from "@/lib/render/renderManager";
import { getAnonymousApiSession } from "@/lib/session/api";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  const authorization = await authorizeOwnedProject(
    session.id,
    (await context.params).projectId
  );
  if (!authorization.authorized) return authorization.response;

  const project = authorization.record.project;
  const state = await getProjectRenderState(authorization.projectId);
  const asset = project.finalVideoAssetId
    ? await getPrivateAsset(session.id, authorization.projectId, project.finalVideoAssetId)
    : null;
  const readable = asset?.kind === "final-video"
    ? await assertPrivateAssetReadable(asset).then(() => true).catch(() => false)
    : false;
  const outputUrl = readable && asset
    ? getProjectAssetUrl(authorization.projectId, asset.id)
    : null;

  return NextResponse.json({
    success: true,
    data: {
      status: readable ? "completed" : state.status,
      outputUrl,
      downloadUrl: readable && asset
        ? getProjectAssetUrl(authorization.projectId, asset.id, true)
        : null,
      sizeBytes: readable && asset ? asset.sizeBytes : 0,
      downloadable: readable
    },
    trace: { route: "final-video" },
    fallbackUsed: false,
    fallbackReason: null,
    error: null
  });
}
