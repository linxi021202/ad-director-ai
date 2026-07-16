import { GenerateWorkflow } from "@/components/GenerateWorkflow";
import type { AITraceStatus } from "@/components/AIModeBadge";
import { requirePageUser } from "@/lib/auth/requireUser";
import { coldBrewDemo } from "@/lib/mock/coldBrewDemo";

export const dynamic = "force-dynamic";

function getAITraceStatus(): AITraceStatus {
  const realTextEnabled = process.env.AI_MODE === "real" && process.env.ENABLE_REAL_TEXT === "true";

  return {
    mode: process.env.AI_MODE === "real" ? "real" : "mock",
    realTextEnabled,
    textModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    videoModel: process.env.HAPPYHORSE_MODEL || "happyhorse-1.0-r2v",
    manualVideoAssetPath: process.env.HAPPYHORSE_VIDEO_ASSET_PATH || "/demo-videos/hero-shot.mp4",
    manualVideoAssetExists: false,
    limits: {
      maxRealVideoShotsPerRun: Number.parseInt(process.env.MAX_REAL_VIDEO_SHOTS_PER_RUN || "1", 10),
      maxVideoSecondsPerShot: Number.parseInt(process.env.MAX_VIDEO_SECONDS_PER_SHOT || "5", 10)
    }
  };
}

export default async function GeneratePage() {
  await requirePageUser("/generate");
  return <GenerateWorkflow project={coldBrewDemo} aiStatus={getAITraceStatus()} />;
}