import { requireApiUser } from "@/lib/auth/api";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  try {
    const body = await request.json().catch(() => ({}));
    const projectId = typeof body?.projectId === "string" ? body.projectId : null;

    return NextResponse.json({
      success: false,
      data: {
        projectId,
        status: "deprecated",
        nextRoute: projectId ? `/api/projects/${projectId}/render` : "/api/projects/{projectId}/render"
      },
      trace: { route: "render-video", stage: "deprecated" },
      fallbackUsed: false,
      fallbackReason: null,
      error: "render-video 已停用。请使用项目级 Remotion 渲染接口生成真实 MP4。"
    }, { status: 410 });
  } catch {
    return NextResponse.json({
      success: false,
      data: null,
      trace: { route: "render-video", stage: "exception" },
      fallbackUsed: false,
      fallbackReason: null,
      error: "render-video 已停用。"
    }, { status: 500 });
  }
}
