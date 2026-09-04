import "server-only";

import { NextResponse } from "next/server";

import { getPrivateAsset } from "@/lib/assets/assetStore";
import { serveProjectAsset } from "@/lib/assets/http";
import { projectReferencesAsset } from "@/lib/assets/membership";
import { authorizeOwnedProject } from "@/lib/projects/api";
import { getAnonymousApiSession } from "@/lib/session/api";

type RouteContext = { params: Promise<{ projectId: string; assetId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function HEAD(request: Request, context: RouteContext) {
  return handle(request, context);
}

async function handle(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { projectId, assetId } = await context.params;
  const authorization = await authorizeOwnedProject(sessionResult.session.id, projectId);
  if (!authorization.authorized) return notFound();

  const asset = await getPrivateAsset(sessionResult.session.id, authorization.projectId, assetId).catch(() => null);
  if (!asset || !projectReferencesAsset(authorization.record.project, asset.id)) return notFound();

  try {
    return await serveProjectAsset(request, asset, { download: new URL(request.url).searchParams.get("download") === "1" });
  } catch {
    return notFound();
  }
}

function notFound() {
  return NextResponse.json({ success: false, data: null, error: "ASSET_NOT_FOUND" }, { status: 404 });
}
