import { z } from "zod";

export const adCompositionPropsSchema = z.object({
  projectId: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  durationInFrames: z.number().int().positive(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  shots: z.array(z.object({
    id: z.string().min(1),
    durationSec: z.number().int().positive(),
    keyframeUrl: z.string().min(1),
    subtitle: z.string().min(1),
    title: z.string().min(1),
    keywords: z.array(z.string().min(1)).max(3).default([])
  })).length(4),
  heroShotId: z.string().min(1),
  heroVideoUrl: z.string().min(1),
  productAssets: z.array(z.object({ url: z.string().min(1), role: z.string().min(1) })),
  cta: z.string().min(1),
  brandName: z.string().min(1),
  backgroundMusicUrl: z.string().optional(),
  voiceoverUrl: z.string().optional()
});

export type AdCompositionProps = z.infer<typeof adCompositionPropsSchema>;

export function getCompositionSize(aspectRatio: AdCompositionProps["aspectRatio"]) {
  if (aspectRatio === "16:9") return { width: 1920, height: 1080 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

export const DEFAULT_FPS = 30;
export const MIN_DURATION_SEC = 25;
export const MAX_DURATION_SEC = 30;
export const DEFAULT_DURATION_SEC = 28;
export const DEFAULT_DURATION_IN_FRAMES = DEFAULT_FPS * DEFAULT_DURATION_SEC;
