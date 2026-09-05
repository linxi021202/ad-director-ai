import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";

import type { AITraceStatus } from "@/components/AIModeBadge";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { getOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import { setLastActiveProjectId } from "@/lib/projects/anonymousWorkspace";
import { requireAnonymousSession } from "@/lib/session/anonymousSession";

export const dynamic = "force-dynamic";

type ProjectPageProps = { params: Promise<{ id: string }> };

function getAITraceStatus(): AITraceStatus {
  const realTextEnabled = process.env.AI_MODE === "real" && process.env.ENABLE_REAL_TEXT === "true";
  const assetPath = process.env.HAPPYHORSE_VIDEO_ASSET_PATH || "/demo-videos/hero-shot.mp4";
  return {
    mode: process.env.AI_MODE === "real" ? "real" : "mock",
    realTextEnabled,
    textModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    videoModel: process.env.WAN_VIDEO_MODEL || "wan2.7-r2v",
    manualVideoAssetPath: assetPath,
    manualVideoAssetExists: hasPublicAsset(assetPath),
    limits: {
      maxRealVideoShotsPerRun: Number.parseInt(process.env.MAX_REAL_VIDEO_SHOTS_PER_RUN || "1", 10),
      maxVideoSecondsPerShot: Number.parseInt(process.env.MAX_VIDEO_SECONDS_PER_SHOT || "7", 10)
    }
  };
}

function hasPublicAsset(assetPath: string) {
  return fs.existsSync(path.join(process.cwd(), "public", assetPath.replace(/^\/+/, "")));
}

export default async function ProjectDetailPage({ params }: ProjectPageProps) {
  const { id } = await params;
  const session = await requireAnonymousSession();
  const record = await getOwnedAnonymousProject(session.id, id);
  if (!record) notFound();
  return <ProjectDetailView project={record.project} projectId={record.id} projectVersion={record.version} aiStatus={getAITraceStatus()} />;
}
