import "server-only";

import { requireApiUser } from "@/lib/auth/api";

import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { cancelProjectRender, getProjectRenderState, startProjectRender } from "@/lib/render/renderManager";
import { renderRequestSchema } from "@/lib/render/renderProject";
import { isActiveRenderStatus, safeSegment } from "@/lib/render/renderStateStore";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  const state = await getProjectRenderState(await getProjectId(context));
  return response(true, state, null, 200);
}

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  try {
    const projectId = await getProjectId(context);
    const current = await getProjectRenderState(projectId);
    if (isActiveRenderStatus(current.status)) return response(false, current, "当前项目正在渲染，请等待完成或先取消。", 409);
    const body = await readRequestBody(request);
    if (body === null) return response(false, null, "渲染请求缺少项目与关键帧数据，请刷新页面后重试。", 400);
    const parsed = renderRequestSchema.safeParse(body);
    if (!parsed.success) return response(false, null, renderValidationMessage(parsed.error), 400);
    const sessionId = authResult.user.id;
    const state = await startProjectRender(projectId, parsed.data, sessionId);
    return response(true, state, null, 202);
  } catch (error) {
    return response(false, null, renderStartupMessage(error), 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  const state = await cancelProjectRender(await getProjectId(context));
  return response(true, state, null, 200);
}

async function getProjectId(context: RouteContext) {
  const params = await context.params;
  return safeSegment(params.projectId);
}
async function readRequestBody(request: Request) {
  try { return await request.json() as unknown; } catch { return null; }
}
function renderValidationMessage(error: ZodError) {
  const firstPath = error.issues[0]?.path.map(String).join(".") ?? "";
  if (!firstPath || firstPath === "project") return "渲染请求缺少完整项目数据，请刷新页面后重试。";
  if (firstPath.startsWith("project.")) return `项目数据不完整：${firstPath.replace(/^project\./, "")}。`;
  if (firstPath.startsWith("keyframes")) return "关键帧清单格式无效，请重新生成关键帧后重试。";
  return "渲染参数无效，请刷新项目后重试。";
}
function renderStartupMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/EACCES|EPERM/i.test(message)) return "渲染任务无法写入本地目录，请检查项目目录权限。";
  if (/ENOSPC/i.test(message)) return "磁盘空间不足，无法启动渲染任务。";
  return "渲染任务创建失败，请检查本地渲染环境后重试。";
}
function response(success: boolean, data: unknown, error: string | null, status: number) {
  return NextResponse.json({ success, data, trace: { route: "project-render" }, fallbackUsed: false, fallbackReason: null, error }, { status });
}

