import { NextResponse } from "next/server";

import { getAnonymousApiSession } from "@/lib/session/api";
import {
  anonymousProjectCreateInputSchema,
  createAnonymousProject,
  listAnonymousProjects
} from "@/lib/projects/anonymousProjectStore";
import { projectStoreErrorResponse, publicAnonymousProject } from "@/lib/projects/api";
import { setLastActiveProjectId } from "@/lib/projects/anonymousWorkspace";

export async function GET() {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;

  const records = await listAnonymousProjects(sessionResult.session.id);
  return NextResponse.json({
    success: true,
    data: { projects: records.map(publicAnonymousProject) }
  }, { headers: { "content-type": "application/json; charset=utf-8" } });
}

export async function POST(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;

  try {
    const input = anonymousProjectCreateInputSchema.parse(await request.json());
    const record = await createAnonymousProject(sessionResult.session.id, input);
    return NextResponse.json({ success: true, data: publicAnonymousProject(record) }, {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? NextResponse.json({
      error: { code: "PROJECT_CREATE_FAILED", message: "项目创建失败，请稍后重试。" }
    }, { status: 500 });
  }
}