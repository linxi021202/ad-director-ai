import { NextRequest, NextResponse } from "next/server";

import { recoverGeneratedKeyframeAssets } from "@/lib/image/keyframeRecovery";
import { parseOwnedProjectId, projectNotFoundResponse, projectStoreErrorResponse } from "@/lib/projects/api";
import { getAnonymousApiSession } from "@/lib/session/api";
import { isSameOrigin } from "@/lib/secrets/security";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = parseOwnedProjectId((await context.params).projectId);
  if (!projectId) return projectNotFoundResponse();
  try {
    const result = await recoverGeneratedKeyframeAssets(sessionResult.session.id, projectId);
    return NextResponse.json({ success: true, data: result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? NextResponse.json({ error: "关键帧资产恢复失败，请稍后重试。" }, { status: 500 });
  }
}
