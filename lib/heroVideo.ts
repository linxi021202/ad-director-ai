import type { GenerationProject, StoryboardShot } from "./schemas/project";
import { appendNoReadableTextRules } from "./prompts/noReadableText";
import { createShotPromptTimeSegments, getDefaultHeroShotArrayIndex } from "./video/shotConfig";
import { buildTimedChoreography, selectShotVideoStrategy } from "./storyboard/shotArchitecture";

export const DEFAULT_HERO_SHOT_ID = "shot-05-hero-transition";
export const MAX_HERO_VIDEO_SIZE = 50 * 1024 * 1024;
export const MIN_HERO_VIDEO_DURATION_SEC = 3;
export const MAX_HERO_VIDEO_DURATION_SEC = 8;

export const HERO_VIDEO_MIME_TYPES = ["video/mp4"] as const;
export const HERO_VIDEO_EXTENSIONS = [".mp4"] as const;

export type HeroVideoStatus =
  | "not-started"
  | "prompt-ready"
  | "waiting-manual-upload"
  | "uploading"
  | "uploaded"
  | "using-demo-asset"
  | "failed"
  | "fallback-to-keyframe";

export type HeroVideoSource =
  | "user-upload"
  | "wan-api"
  | "happyhorse-manual-import"
  | "happyhorse-api"
  | "happyhorse"
  | "local-demo-asset";

export type HeroVideoFileMeta = {
  name: string;
  type: string;
  size: number;
};

export type HeroVideoStateInput = {
  hasHeroShot: boolean;
  promptReady?: boolean;
  waitingManualUpload?: boolean;
  uploading?: boolean;
  videoSource?: HeroVideoSource | null;
  error?: string | null;
  fallbackToKeyframe?: boolean;
};

export function resolveHeroShot(
  shots: StoryboardShot[],
  heroShotId?: string
) {
  const dynamicDefaultIndex = getDefaultHeroShotArrayIndex(shots.length);

  return (heroShotId ? shots.find((shot) => shot.id === heroShotId) : undefined)
    ?? shots[dynamicDefaultIndex]
    ?? shots[0]
    ?? null;
}

export function setProjectHeroShot(
  project: GenerationProject,
  shot: StoryboardShot
): GenerationProject {
  return {
    ...project,
    heroShotId: shot.id,
    updatedAt: new Date().toISOString()
  };
}

export function getHeroVideoStatus(input: HeroVideoStateInput): HeroVideoStatus {
  if (!input.hasHeroShot) return "not-started";
  if (input.error) return "failed";
  if (input.uploading) return "uploading";
  if (input.fallbackToKeyframe) return "fallback-to-keyframe";
  if (input.videoSource === "local-demo-asset") return "using-demo-asset";
  if (
    input.videoSource === "user-upload"
    || input.videoSource === "wan-api"
    || input.videoSource === "happyhorse"
    || input.videoSource === "happyhorse-api"
    || input.videoSource === "happyhorse-manual-import"
  ) {
    return "uploaded";
  }
  if (input.waitingManualUpload) return "waiting-manual-upload";
  if (input.promptReady) return "prompt-ready";
  return "not-started";
}

export function validateHeroVideoFile(
  file: HeroVideoFileMeta
): { success: true } | { success: false; error: string } {
  const extension = getFileExtension(file.name);
  const isSupportedType = HERO_VIDEO_MIME_TYPES.includes(
    file.type as (typeof HERO_VIDEO_MIME_TYPES)[number]
  );
  const isSupportedExtension = HERO_VIDEO_EXTENSIONS.includes(
    extension as (typeof HERO_VIDEO_EXTENSIONS)[number]
  );

  if (!isSupportedType || !isSupportedExtension) {
    return { success: false, error: "仅支持 MP4 视频文件。" };
  }
  if (file.size > MAX_HERO_VIDEO_SIZE) {
    return { success: false, error: "单个视频不能超过 50MB。" };
  }

  return { success: true };
}

export function createLocalDemoHeroVideo(assetPath = "/demo-videos/hero-shot.mp4") {
  return {
    source: "local-demo-asset" as const,
    url: assetPath,
    name: assetPath.split("/").filter(Boolean).pop() || "hero-shot.mp4",
    type: "video/mp4",
    path: assetPath,
    durationSec: null,
    fallbackReady: true
  };
}

export function buildOptimizedVideoPrompt(shot: StoryboardShot) {
  const strategy = selectShotVideoStrategy(shot);
  const [opening, development, closing] = createShotPromptTimeSegments(shot.durationSec);
  return appendNoReadableTextRules([
    `使用用户上传的真实产品图作为产品外观参考，并使用当前主镜头关键帧作为场景构图参考，生成 ${shot.durationSec} 秒广告视频。`,
    "真实产品图仅用于保持包装结构、颜色、材质和比例一致；不得让模型合成或重绘任何可读包装文字与 Logo 文字。",
    `主体画面：${shot.visualDescription}`,
    `视频策略：${strategy}。严格按以下时间编舞执行，每段只做一个简单、可见、可连续完成的动作：`,
    `阶段摘要：${opening.startSec}–${opening.endSec} 秒建立；${development.startSec}–${development.endSec} 秒推进；${closing.startSec}–${closing.endSec} 秒稳定收束。`,
    buildTimedChoreography(shot),
    `DeepSeek 视频提示词：${shot.videoPromptCn}`,
    "镜头运动仅使用缓慢推进或轻微横移，并允许自然、细微的光线变化。",
    "保持当前画幅比例、主体位置和场景构图，不新增人物，不新增其他产品。",
    "全程只能有一个完整画面。禁止分屏、多面板、拼贴、网格、接触表、画中画、蒙太奇或同屏多个时刻。",
    "ONE SCREEN ONLY: one continuous full-frame composition, never split-screen, panels, collage, grid, contact sheet, picture-in-picture, montage, or simultaneous moments.",
    "真实广告标题、卖点、字幕和 CTA 全部由 Remotion 后期叠加。",
    "画面应具有真实商业广告质感，产品始终清晰、稳定、可识别。"
  ].join("\n"));
}

function getFileExtension(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}
