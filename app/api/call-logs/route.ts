import { NextRequest, NextResponse } from "next/server";

import { clearModelCallLogs, listModelCallLogs } from "@/lib/logs/modelCallStore";
import { parseOwnedProjectId, projectNotFoundResponse, projectStoreErrorResponse } from "@/lib/projects/api";
import { clearOwnedProjectDiagnosticHistory } from "@/lib/projects/anonymousProjectStore";
import { isRateLimited, isSameOrigin } from "@/lib/secrets/security";
import { getAnonymousApiSession } from "@/lib/session/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const query = new URL(request.url).searchParams;
  const rawProjectId = query.get("projectId");
  const projectId = rawProjectId ? parseOwnedProjectId(rawProjectId) : undefined;
  if (rawProjectId && !projectId) return projectNotFoundResponse();
  const limit = Number.parseInt(query.get("limit") ?? "50", 10);
  const before = Number.parseInt(query.get("before") ?? "0", 10);
  const shotId = query.get("shotId");
  const frameId = query.get("frameId");
  const stage = query.get("stage");
  if ((shotId || frameId || stage) && (!projectId || (shotId?.length ?? 0) > 140 || (frameId?.length ?? 0) > 140 || (stage?.length ?? 0) > 40)) return NextResponse.json({ error: "日志筛选参数无效。" }, { status: 400 });
  try {
    const entries = await listModelCallLogs(sessionResult.session.id, {
      ...(projectId ? { projectId } : {}),
      ...(shotId ? { shotId } : {}),
      ...(frameId ? { frameId } : {}),
      ...(stage ? { stage } : {}),
      limit: Number.isFinite(limit) ? limit : 50,
      ...(Number.isFinite(before) && before > 0 ? { before } : {})
    });
    return NextResponse.json({ success: true, data: { entries } }, {
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" }
    });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? NextResponse.json({ error: { code: "CALL_LOG_READ_FAILED", message: "调用日志暂时无法读取。" } }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  if (isRateLimited(`${sessionResult.session.id}:clear-call-logs`, 6)) return NextResponse.json({ error: "操作过于频繁，请稍后重试。" }, { status: 429 });
  const projectId = parseOwnedProjectId(request.nextUrl.searchParams.get("projectId") ?? "");
  if (!projectId) return projectNotFoundResponse();
  try {
    const result = await clearOwnedProjectDiagnosticHistory(sessionResult.session.id, projectId,
      () => clearModelCallLogs(sessionResult.session.id, projectId));
    if (result.activeCount) return NextResponse.json({ error: `当前仍有 ${result.activeCount} 个生成任务运行，请等待完成后再清空日志。`, activeCount: result.activeCount }, { status: 409 });
    return NextResponse.json({ success: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? NextResponse.json({ error: "清空调用日志失败，请稍后重试。" }, { status: 500 });
  }
}
