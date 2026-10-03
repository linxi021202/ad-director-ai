import { redirect } from "next/navigation";

import { GenerateWorkflow } from "@/components/GenerateWorkflow";
import { ProjectEntryPage } from "@/components/projects/ProjectEntryPage";
import type { AITraceStatus } from "@/components/AIModeBadge";
import { MAX_ANONYMOUS_PROJECTS, getOwnedAnonymousProject, listAnonymousProjects } from "@/lib/projects/anonymousProjectStore";
import { setLastActiveProjectId } from "@/lib/projects/anonymousWorkspace";
import { requireAnonymousSession } from "@/lib/session/anonymousSession";

export const dynamic = "force-dynamic";

type GeneratePageProps = {
  searchParams?: Promise<{ projectId?: string; new?: string; notice?: string }>;
};

function getAITraceStatus(): AITraceStatus {
  const realTextEnabled = process.env.AI_MODE === "real" && process.env.ENABLE_REAL_TEXT === "true";
  return {
    mode: process.env.AI_MODE === "real" ? "real" : "mock",
    realTextEnabled,
    textModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
    videoModel: process.env.WAN_VIDEO_MODEL || "wan2.7-i2v",
    manualVideoAssetPath: process.env.HAPPYHORSE_VIDEO_ASSET_PATH || "/demo-videos/hero-shot.mp4",
    manualVideoAssetExists: false,
    limits: {
      maxRealVideoShotsPerRun: Number.parseInt(process.env.MAX_REAL_VIDEO_SHOTS_PER_RUN || "1", 10),
      maxVideoSecondsPerShot: Number.parseInt(process.env.MAX_VIDEO_SECONDS_PER_SHOT || "7", 10)
    }
  };
}

export default async function GeneratePage({ searchParams }: GeneratePageProps) {
  const session = await requireAnonymousSession();
  const params = await searchParams;
  const requestedId = params?.projectId;
  const projects = await listAnonymousProjects(session.id);
  const canCreateProject = projects.length < MAX_ANONYMOUS_PROJECTS;

  if (requestedId) {
    const requested = await getOwnedAnonymousProject(session.id, requestedId);
    if (!requested) redirect("/generate?notice=project-unavailable");
    await setLastActiveProjectId(session.id, requested.id);
    return <GenerateWorkflow key={requested.id} project={requested.project} projectVersion={requested.version} aiStatus={getAITraceStatus()} canCreateProject={canCreateProject} />;
  }

  return <ProjectEntryPage notice={params?.notice === "project-unavailable" ? "项目不存在或当前会话无法访问。" : undefined} />;
}
