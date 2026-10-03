import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAnonymousApiSession } from "@/lib/session/api";
import { resetWorkspaceForVisit } from "@/lib/projects/temporaryWorkspace";
import { isSameOrigin } from "@/lib/secrets/security";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: { message: "无法验证工作台请求，请重新打开网站。" } }, { status: 403 });
  }
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const input = z.object({ visitId: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: { message: "工作台会话标记无效，请重试。" } }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await resetWorkspaceForVisit(sessionResult.session.id, input.data.visitId) });
  } catch (error) {
    return NextResponse.json({ error: { message: "临时工作台清理未完成，上传视频已保留，请重试。" } }, { status: 500 });
  }
}
