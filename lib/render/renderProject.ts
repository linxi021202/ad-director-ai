import "server-only";

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { assertPrivateAssetReadable, requirePrivateAsset } from "../assets/assetStore";
import { getInternalRenderAssetUrl, issueRenderAssetToken } from "../assets/renderAccess";
import { resolvePrivateProjectDirectory } from "../assets/path";
import { generationProjectSchema, type StoryboardShot } from "../schemas/project";
import {  DEFAULT_FPS,
  adCompositionPropsSchema,
  getCompositionSize,
  type AdCompositionProps
} from "../../remotion/schemas";
import { getDurationInFrames } from "../video/durationConfig";
import { getDefaultHeroShotArrayIndex } from "../video/shotConfig";
import type { RenderErrorCode } from "./renderStateStore";
import { safeSegment } from "./renderStateStore";

const keyframeManifestItemSchema = z.object({
  shotId: z.string().min(1),
  assetId: z.string().uuid().optional(),
  imageUrl: z.string().optional(),
  localUrl: z.string().optional(),
  fallbackUsed: z.boolean().optional(),
  status: z.string().optional()
}).passthrough();

export const renderRequestSchema = z.object({
  project: generationProjectSchema,
  keyframes: z.record(keyframeManifestItemSchema).optional(),
  voiceoverUrl: z.string().optional()
});

export type RenderRequestInput = z.infer<typeof renderRequestSchema>;
export type RenderPreparationContext = {
  sessionId: string;
  assetBaseUrl: string;
  renderId: string;
};

export type PreparedRenderProject = {
  inputProps: AdCompositionProps;
  outputLocation: string;
  compositionId: "AdDirectorFinal";
  renderAssetToken: string;
};

export class RenderProjectError extends Error {
  constructor(public readonly code: RenderErrorCode, message: string) {
    super(message);
    this.name = "RenderProjectError";
  }
}

export async function prepareRenderProject(
  projectId: string,
  input: RenderRequestInput,
  context: RenderPreparationContext
): Promise<PreparedRenderProject> {
  const safeProjectId = safeSegment(projectId);
  const project = generationProjectSchema.parse(input.project);
  if (project.id !== safeProjectId) {
    throw new RenderProjectError("MEDIA_UNREADABLE", "项目 ID 与渲染项目不一致。");
  }

  const size = getCompositionSize(project.brief.aspectRatio);
  const heroShotId = project.heroShotId || project.shots[getDefaultHeroShotArrayIndex(project.shots.length)]?.id || project.shots[0]?.id;
  const keyframeAssetIds = project.shots.map((shot) => {
    const frame = project.keyframes?.find((item) => item.shotId === shot.id);
    if (!frame?.assetId || frame.fallbackUsed) {
      throw new RenderProjectError("KEYFRAME_MISSING", `镜头 ${shot.index} 缺少可用于合成的私有关键帧。`);
    }
    return frame.assetId;
  });

  const heroVideoAssetId = project.heroVideo?.assetId;
  if (!heroVideoAssetId || project.heroVideo?.shotId !== heroShotId) {
    throw new RenderProjectError("HERO_VIDEO_MISSING", "当前主镜头缺少可用于合成的私有 HappyHorse 视频。");
  }

  const productAssetIds = (project.brief.productImages ?? []).flatMap((image) => image.assetId ? [image.assetId] : []);
  const narrationAssetIds = project.narrationAssetId ? [project.narrationAssetId] : [];
  const backgroundMusicAssetIds = project.backgroundMusicAssetId ? [project.backgroundMusicAssetId] : [];
  const allowedAssetIds = [...new Set([
    ...keyframeAssetIds,
    heroVideoAssetId,
    ...productAssetIds,
    ...narrationAssetIds,
    ...backgroundMusicAssetIds
  ])];

  for (const assetId of allowedAssetIds) {
    const asset = await requirePrivateAsset(context.sessionId, projectId, assetId);
    await assertPrivateAssetReadable(asset);
  }

  const renderAssetToken = await issueRenderAssetToken({
    sessionId: context.sessionId,
    projectId,
    renderId: context.renderId,
    assetIds: allowedAssetIds,
    ttlMs: 25 * 60 * 1000
  });
  const assetUrl = (assetId: string) =>
    getInternalRenderAssetUrl(context.assetBaseUrl, assetId, renderAssetToken);

  const shots = project.shots.map((shot, index) => ({
    id: shot.id,
    durationSec: shot.durationSec,
    keyframeUrl: assetUrl(keyframeAssetIds[index]!),
    subtitle: shot.subtitle,
    title: shot.goal,
    keywords: extractShotKeywords(shot, project.brief.sellingPoints)
  }));
  const productAssets: AdCompositionProps["productAssets"] = [];
  for (const image of project.brief.productImages ?? []) {
    if (image.assetId) productAssets.push({ url: assetUrl(image.assetId), role: image.role });
  }

  const outputDirectory = path.join(
    resolvePrivateProjectDirectory(context.sessionId, projectId),
    "render-work",
    context.renderId
  );
  await mkdir(outputDirectory, { recursive: true });

  const inputProps = adCompositionPropsSchema.parse({
    projectId,
    width: size.width,
    height: size.height,
    fps: DEFAULT_FPS,
    durationInFrames: getDurationInFrames(project.shots, DEFAULT_FPS),
    aspectRatio: project.brief.aspectRatio,
    shots,
    heroShotId,
    heroVideoUrl: assetUrl(heroVideoAssetId),
    productAssets,
    cta: project.strategy.cta,
    brandName: project.brief.productName,
    backgroundMusicUrl: project.backgroundMusicAssetId ? assetUrl(project.backgroundMusicAssetId) : undefined,
    voiceoverUrl: project.narrationAssetId ? assetUrl(project.narrationAssetId) : undefined
  });

  return {
    inputProps,
    outputLocation: path.join(outputDirectory, "ad-final.mp4"),
    compositionId: "AdDirectorFinal",
    renderAssetToken
  };
}

export function sumShotDurations(shots: Pick<StoryboardShot, "durationSec">[]) {
  return shots.reduce((sum, shot) => sum + shot.durationSec, 0);
}

export function normalizeShotDurations(
  shots: Pick<StoryboardShot, "durationSec">[],
  targetDurationSec?: number
) {
  if (shots.length === 0) return [];
  if (targetDurationSec === undefined) return shots.map((shot) => shot.durationSec);
  if (targetDurationSec < shots.length) {
    throw new RenderProjectError("INVALID_DURATION", "成片时长不足以容纳全部镜头。");
  }

  const sourceTotal = Math.max(1, sumShotDurations(shots));
  const distributable = targetDurationSec - shots.length;
  const weighted = shots.map((shot, index) => {
    const raw = (shot.durationSec / sourceTotal) * distributable;
    return { index, seconds: 1 + Math.floor(raw), remainder: raw - Math.floor(raw) };
  });
  let allocated = weighted.reduce((sum, item) => sum + item.seconds, 0);
  const order = [...weighted].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let cursor = 0; allocated < targetDurationSec; cursor += 1) {
    order[cursor % order.length]!.seconds += 1;
    allocated += 1;
  }
  return weighted.sort((a, b) => a.index - b.index).map((item) => item.seconds);
}

export function getTimelineBoundaries(
  shots: Pick<StoryboardShot, "id" | "durationSec">[]
) {
  let cursor = 0;
  return shots.map((shot) => {
    const startSec = cursor;
    cursor += shot.durationSec;
    return { id: shot.id, startSec, endSec: cursor, durationSec: shot.durationSec };
  });
}

export function resolveShotKeyframeUrl(
  _projectId: string,
  shot: Pick<StoryboardShot, "id" | "index">,
  keyframes?: RenderRequestInput["keyframes"]
) {
  const manifest = keyframes?.[shot.id];
  return manifest?.localUrl || manifest?.imageUrl || "";
}

export function isForbiddenRenderUrl(url: string) {
  if (!url) return true;
  if (/^(blob:|data:)/i.test(url)) return true;
  if (url.includes("/mock/") || url.includes("placeholder") || url.includes("landing-cold-brew-hero")) return true;
  return false;
}

export function extractShotKeywords(
  shot: Pick<StoryboardShot, "subtitle" | "goal">,
  sellingPoints: string[] = []
) {
  const candidates = [...sellingPoints, shot.subtitle, shot.goal]
    .flatMap((value) => value.split(/[，。！？、|/]/))
    .map((value) => value.trim())
    .map((value) => value.replace(/^(低糖|冷萃|轻负担)[:：]?/, "$1"))
    .filter((value) => value.length >= 2 && value.length <= 10);
  return [...new Set(candidates)].slice(0, 3);
}

export function localPublicPath(): never {
  throw new RenderProjectError("MEDIA_UNREADABLE", "私有渲染不允许解析 public 媒体路径。");
}