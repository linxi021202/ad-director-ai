import { NextResponse } from "next/server";

import { getAnonymousApiSession } from "@/lib/session/api";
import {
  anonymousProjectCreateInputSchema,
  createAnonymousProject,
  listAnonymousProjects
} from "@/lib/projects/anonymousProjectStore";
import { projectStoreErrorResponse, publicAnonymousProject } from "@/lib/projects/api";
import { setLastActiveProjectId } from "@/lib/projects/anonymousWorkspace";

export async function GET(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;

  const records = await listAnonymousProjects(sessionResult.session.id);
  if (new URL(request.url).searchParams.get("summary") === "1") return NextResponse.json({ success: true, data: {
    projects: records.map((record) => ({ projectId: record.id, name: record.project.brief.productName,
      updatedAt: record.updatedAt, stage: projectStageLabel(record.project) }))
  } }, { headers: { "cache-control": "no-store" } });
  return NextResponse.json({
    success: true,
    data: { projects: records.map(publicAnonymousProject) }
  }, { headers: { "content-type": "application/json; charset=utf-8" } });
}

function projectStageLabel(project: Awaited<ReturnType<typeof listAnonymousProjects>>[number]["project"]) {
  const stages = ["brief", "creative", "anchors", "storyboard", "keyframes", "video", "final"] as const;
  const labels = ["商品与创意", "创意方向", "人物与场景", "分镜制作", "关键帧制作", "视频制作", "成片"] as const;
  const index = stages.findLastIndex((stage) => project.stageStates?.[stage]?.status !== "blocked");
  return labels[Math.max(index, 0)];
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
