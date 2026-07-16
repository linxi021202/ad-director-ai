import "server-only";

import { requireApiUser } from "@/lib/auth/api";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { safeSegment } from "@/lib/render/renderStateStore";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  const projectId = await getProjectId(context);
  const filePath = path.join(process.cwd(), "public", "generated", projectId, "final", "ad-final.mp4");
  const fileInfo = await stat(filePath).catch(() => null);
  if (!fileInfo?.isFile() || fileInfo.size <= 0) {
    return NextResponse.json({
      success: false,
      data: null,
      trace: { route: "download-final-video" },
      fallbackUsed: false,
      fallbackReason: null,
      error: "最终 MP4 尚未生成，无法下载。"
    }, { status: 404 });
  }

  const file = await readFile(filePath);
  return new NextResponse(file, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${projectId}-ad-final.mp4"`,
      "Content-Length": String(file.length)
    }
  });
}

async function getProjectId(context: RouteContext) {
  const params = await context.params;
  return safeSegment(params.projectId);
}
