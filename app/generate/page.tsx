import { notFound, redirect } from "next/navigation";

import { GenerateWorkflow } from "@/components/GenerateWorkflow";
import type { AITraceStatus } from "@/components/AIModeBadge";
import {
  AnonymousProjectLimitError,
  MAX_ANONYMOUS_PROJECTS,
  createAnonymousProject,
  getOwnedAnonymousProject,
  listAnonymousProjects
} from "@/lib/projects/anonymousProjectStore";
import { getLastActiveProjectId, setLastActiveProjectId } from "@/lib/projects/anonymousWorkspace";
import { requireAnonymousSession } from "@/lib/session/anonymousSession";

export const dynamic = "force-dynamic";

type GeneratePageProps = {
  searchParams?: Promise<{ projectId?: string; new?: string }>;
};

function getAITraceStatus(): AITraceStatus {
  const realTextEnabled = process.env.AI_MODE === "real" && process.env.ENABLE_REAL_TEXT === "true";
  return {
    mode: process.env.AI_MODE === "real" ? "real" : "mock",
    realTextEnabled,
    textModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    videoModel: process.env.WAN_VIDEO_MODEL || "wan2.7-r2v",
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
    if (!requested) notFound();
    await setLastActiveProjectId(session.id, requested.id);
    return <GenerateWorkflow project={requested.project} projectVersion={requested.version} aiStatus={getAITraceStatus()} canCreateProject={canCreateProject} />;
  }

  if (params?.new === "1") {
    try {
      const created = await createAnonymousProject(session.id);
      await setLastActiveProjectId(session.id, created.id);
      return (
        <GenerateWorkflow
          project={created.project}
          projectVersion={created.version}
          aiStatus={getAITraceStatus()}
          canCreateProject={projects.length + 1 < MAX_ANONYMOUS_PROJECTS}
        />
      );
    } catch (error) {
      if (error instanceof AnonymousProjectLimitError) redirect("/projects?notice=project-limit");
      throw error;
    }
  }

  const lastActiveId = await getLastActiveProjectId(session.id);
  const lastActive = lastActiveId ? await getOwnedAnonymousProject(session.id, lastActiveId) : null;
  const record = lastActive ?? projects[0] ?? await createAnonymousProject(session.id);
  await setLastActiveProjectId(session.id, record.id);

  return <GenerateWorkflow project={record.project} projectVersion={record.version} aiStatus={getAITraceStatus()} canCreateProject={canCreateProject} />;
}
