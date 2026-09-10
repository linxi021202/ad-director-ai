import { z } from "zod";
import {
  DEFAULT_FPS,
  DEFAULT_SHOT_COUNT,
  DEFAULT_SHOT_DURATION_SEC,
  MAX_SHOT_COUNT,
  MAX_SHOT_DURATION_SEC,
  MIN_SHOT_COUNT,
  MIN_SHOT_DURATION_SEC
} from "../lib/video/shotConfig";

export const adCompositionPropsSchema = z.object({
  projectId: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  durationInFrames: z.number().int().positive(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  shots: z.array(z.object({
    id: z.string().min(1),
    durationSec: z.number().int().min(MIN_SHOT_DURATION_SEC).max(MAX_SHOT_DURATION_SEC),
    keyframeUrl: z.string().min(1),
    subtitle: z.string(),
    title: z.string().min(1),
    keywords: z.array(z.string().min(1)).max(3).default([]),
    subclips: z.array(z.object({
      id: z.string().min(1), url: z.string().min(1), durationSec: z.number().positive()
    }).strict()).max(2).default([])
  })).min(1).max(12),
  heroShotId: z.string().min(1),
  heroVideoUrl: z.string().min(1),
  productAssets: z.array(z.object({ url: z.string().min(1), role: z.string().min(1) })),
  cta: z.string().min(1),
  brandName: z.string().min(1),
  backgroundMusicUrl: z.string().optional(),
  voiceoverUrl: z.string().optional(),
  narrationBeats: z.array(z.object({
    id: z.string().min(1),
    shotId: z.string().min(1),
    text: z.string().min(1),
    displayText: z.string().min(1).optional(),
    audioUrl: z.string().min(1),
    durationSec: z.number().positive()
  }).strict()).max(MAX_SHOT_COUNT).default([])
});

export type AdCompositionProps = z.infer<typeof adCompositionPropsSchema>;

export function getCompositionSize(aspectRatio: AdCompositionProps["aspectRatio"]) {
  if (aspectRatio === "16:9") return { width: 1920, height: 1080 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

export { DEFAULT_FPS };
export const MIN_DURATION_SEC = MIN_SHOT_COUNT * MIN_SHOT_DURATION_SEC;
export const MAX_DURATION_SEC = MAX_SHOT_COUNT * MAX_SHOT_DURATION_SEC;
export const DEFAULT_DURATION_SEC = DEFAULT_SHOT_COUNT * DEFAULT_SHOT_DURATION_SEC;
export const DEFAULT_DURATION_IN_FRAMES = DEFAULT_FPS * DEFAULT_DURATION_SEC;
