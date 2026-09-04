import { getAnonymousApiSession } from "@/lib/session/api";
import { authorizeOwnedProject } from "@/lib/projects/api";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  try {
    const body = await request.json().catch(() => ({}));
    const requestedProjectId = typeof body?.projectId === "string" ? body.projectId : null;
    if (!requestedProjectId) {
      return NextResponse.json({
        success: false, data: null, trace: { route: "render-video", stage: "validation" },
        fallbackUsed: false, fallbackReason: null, error: "缺少项目 ID。"
      }, { status: 400 });
    }
    const authorization = await authorizeOwnedProject(session.id, requestedProjectId);
    if (!authorization.authorized) return authorization.response;
    const projectId = authorization.projectId;

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
