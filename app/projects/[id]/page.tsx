import fs from "node:fs";
import path from "node:path";

import type { AITraceStatus } from "@/components/AIModeBadge";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { requirePageUser } from "@/lib/auth/requireUser";
import { coldBrewDemo } from "@/lib/mock/coldBrewDemo";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function getAITraceStatus(): AITraceStatus {
  const realTextEnabled = process.env.AI_MODE === "real" && process.env.ENABLE_REAL_TEXT === "true";
  const assetPath = process.env.HAPPYHORSE_VIDEO_ASSET_PATH || "/demo-videos/hero-shot.mp4";

  return {
    mode: process.env.AI_MODE === "real" ? "real" : "mock",
    realTextEnabled,
    textModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    videoModel: process.env.HAPPYHORSE_MODEL || "happyhorse-1.0-r2v",
    manualVideoAssetPath: assetPath,
    manualVideoAssetExists: hasPublicAsset(assetPath),
    limits: {
      maxRealVideoShotsPerRun: Number.parseInt(process.env.MAX_REAL_VIDEO_SHOTS_PER_RUN || "1", 10),
      maxVideoSecondsPerShot: Number.parseInt(process.env.MAX_VIDEO_SECONDS_PER_SHOT || "5", 10)
    }
  };
}

function hasPublicAsset(assetPath: string) {
  const cleanPath = assetPath.replace(/^\/+/, "");
  const fullPath = path.join(process.cwd(), "public", cleanPath);
  return fs.existsSync(fullPath);
}

export default async function ProjectDetailPage({ params }: ProjectPageProps) {
  const { id } = await params;
  await requirePageUser("/projects/" + id);

  return <ProjectDetailView project={coldBrewDemo} projectId={id} aiStatus={getAITraceStatus()} />;
}