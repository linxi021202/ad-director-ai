import "server-only";

import { requireApiUser } from "@/lib/auth/api";

import { stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getProjectRenderState } from "@/lib/render/renderManager";
import { safeSegment } from "@/lib/render/renderStateStore";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  const projectId = await getProjectId(context);
  const state = await getProjectRenderState(projectId);
  const filePath = path.join(process.cwd(), "public", "generated", projectId, "final", "ad-final.mp4");
  const fileInfo = await stat(filePath).catch(() => null);
  const exists = Boolean(fileInfo?.isFile() && fileInfo.size > 0);

  return NextResponse.json({
    success: true,
    data: {
      status: exists ? "completed" : state.status,
      outputUrl: exists ? `/generated/${projectId}/final/ad-final.mp4` : state.outputUrl,
      sizeBytes: exists ? fileInfo?.size ?? 0 : 0,
      downloadable: exists
    },
    trace: { route: "final-video" },
    fallbackUsed: false,
    fallbackReason: null,
    error: null
  });
}

async function getProjectId(context: RouteContext) {
  const params = await context.params;
  return safeSegment(params.projectId);
}
