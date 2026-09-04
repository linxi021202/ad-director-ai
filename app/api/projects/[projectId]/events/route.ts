import { NextResponse } from "next/server";

import { listGenerationEvents } from "@/lib/projects/generationEvents";
import { parseOwnedProjectId, projectNotFoundResponse, projectStoreErrorResponse } from "@/lib/projects/api";
import { getAnonymousApiSession } from "@/lib/session/api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = parseOwnedProjectId((await context.params).projectId);
  if (!projectId) return projectNotFoundResponse();

  try {
    const url = new URL(request.url);
    const after = Number.parseInt(url.searchParams.get("after") || "0", 10);
    const limit = Number.parseInt(url.searchParams.get("limit") || "200", 10);
    const events = await listGenerationEvents(sessionResult.session.id, projectId, {
      after: Number.isFinite(after) ? after : 0,
      limit: Number.isFinite(limit) ? limit : 200
    });
    return NextResponse.json({ success: true, data: { events } }, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? projectNotFoundResponse();
  }
}