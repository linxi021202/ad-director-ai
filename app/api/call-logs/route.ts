import { NextResponse } from "next/server";

import { listModelCallLogs } from "@/lib/logs/modelCallStore";
import { parseOwnedProjectId, projectNotFoundResponse, projectStoreErrorResponse } from "@/lib/projects/api";
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
  try {
    const entries = await listModelCallLogs(sessionResult.session.id, {
      ...(projectId ? { projectId } : {}),
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
