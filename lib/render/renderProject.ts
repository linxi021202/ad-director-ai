import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { readHeroVideoProjectState } from "../heroVideoAsset";
import { generationProjectSchema, type GenerationProject, type StoryboardShot } from "../schemas/project";
import {
  DEFAULT_DURATION_SEC,
  DEFAULT_FPS,
  adCompositionPropsSchema,
  getCompositionSize,
  type AdCompositionProps
} from "../../remotion/schemas";
import type { RenderErrorCode } from "./renderStateStore";
import { safeSegment } from "./renderStateStore";

const keyframeManifestItemSchema = z.object({
  shotId: z.string().min(1),
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

export type PreparedRenderProject = {
  inputProps: AdCompositionProps;
  outputLocation: string;
  outputUrl: string;
  compositionId: "AdDirectorFinal";
};

export class RenderProjectError extends Error {
  constructor(
    public readonly code: RenderErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RenderProjectError";
  }
}

export async function prepareRenderProject(projectId: string, input: RenderRequestInput): Promise<PreparedRenderProject> {
  const safeProjectId = safeSegment(projectId);
  const project = input.project;
  const size = getCompositionSize(project.brief.aspectRatio);
  const heroShotId = project.heroShotId || "shot-3";
  const targetDurationSec = Math.min(30, Math.max(25, Math.round(project.brief.durationSec || DEFAULT_DURATION_SEC)));
  const normalizedDurations = normalizeShotDurations(project.shots, targetDurationSec);

  if (project.id !== safeProjectId) {
    throw new RenderProjectError("MEDIA_UNREADABLE", "项目 ID 与渲染路径不一致。");
  }

  if (!["9:16", "16:9", "1:1"].includes(project.brief.aspectRatio)) {
    throw new RenderProjectError("INVALID_ASPECT_RATIO", "当前画幅暂不支持成片合成。");
  }

  const shots = await Promise.all(project.shots.map((shot, index) =>
    toCompositionShot(
      safeProjectId,
      { ...shot, durationSec: normalizedDurations[index] ?? shot.durationSec },
      input.keyframes,
      project.brief.sellingPoints
    )
  ));
  const heroState = await readHeroVideoProjectState(safeProjectId);
  const heroVideo = heroState.heroVideoAsset;
  if (!heroVideo || heroVideo.shotId !== heroShotId) {
    throw new RenderProjectError("HERO_VIDEO_MISSING", "当前主镜头缺少已导入的 HappyHorse 视频。");
  }

  await assertReadableLocalVideo(heroVideo.publicUrl);
  const productAssets = await collectReadableProductAssets(project);
  const voiceoverUrl = stripQuery(input.voiceoverUrl || "");
  if (voiceoverUrl) await assertReadableLocalAudio(voiceoverUrl);
  const outputDir = path.join(process.cwd(), "public", "generated", safeProjectId, "final");
  const outputLocation = path.join(outputDir, "ad-final.mp4");
  await mkdir(outputDir, { recursive: true });

  const inputProps = adCompositionPropsSchema.parse({
    projectId: safeProjectId,
    width: size.width,
    height: size.height,
    fps: DEFAULT_FPS,
    durationInFrames: DEFAULT_FPS * targetDurationSec,
    aspectRatio: project.brief.aspectRatio,
    shots,
    heroShotId,
    heroVideoUrl: heroVideo.publicUrl,
    productAssets,
    cta: project.strategy.cta,
    brandName: project.brief.productName,
    voiceoverUrl: voiceoverUrl || undefined
  });

  return {
    inputProps,
    outputLocation,
    outputUrl: `/generated/${safeProjectId}/final/ad-final.mp4`,
    compositionId: "AdDirectorFinal"
  };
}

export function sumShotDurations(shots: Pick<StoryboardShot, "durationSec">[]) {
  return shots.reduce((sum, shot) => sum + shot.durationSec, 0);
}

export function normalizeShotDurations(
  shots: Pick<StoryboardShot, "durationSec">[],
  targetDurationSec = DEFAULT_DURATION_SEC
) {
  if (shots.length === 0) return [];
  const minimumTotal = shots.length;
  if (targetDurationSec < minimumTotal) {
    throw new RenderProjectError("INVALID_DURATION", "成片时长不足以容纳全部镜头。");
  }

  const sourceTotal = Math.max(1, sumShotDurations(shots));
  const distributable = targetDurationSec - minimumTotal;
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

export function getTimelineBoundaries(shots: Pick<StoryboardShot, "id" | "durationSec">[]) {
  let cursor = 0;
  return shots.map((shot) => {
    const startSec = cursor;
    cursor += shot.durationSec;
    return { id: shot.id, startSec, endSec: cursor, durationSec: shot.durationSec };
  });
}

export function resolveShotKeyframeUrl(
  projectId: string,
  shot: Pick<StoryboardShot, "id" | "index">,
  keyframes?: RenderRequestInput["keyframes"]
) {
  const manifest = keyframes?.[shot.id];
  const manifestUrl = stripQuery(manifest?.localUrl || manifest?.imageUrl || "");
  if (manifestUrl && !isForbiddenRenderUrl(manifestUrl)) return manifestUrl;
  return `/generated/images/${safeSegment(projectId)}/shot-${shot.index}.png`;
}

export function isForbiddenRenderUrl(url: string) {
  if (!url) return true;
  if (/^(https?:|blob:|data:)/i.test(url)) return true;
  if (url.includes("/mock/")) return true;
  if (url.includes("placeholder")) return true;
  if (url.includes("landing-cold-brew-hero")) return true;
  return false;
}

async function toCompositionShot(
  projectId: string,
  shot: StoryboardShot,
  keyframes?: RenderRequestInput["keyframes"],
  sellingPoints: string[] = []
): Promise<AdCompositionProps["shots"][number]> {
  const keyframeUrl = resolveShotKeyframeUrl(projectId, shot, keyframes);
  if (isForbiddenRenderUrl(keyframeUrl)) {
    throw new RenderProjectError("KEYFRAME_MISSING", `镜头 ${shot.index} 缺少可用于合成的本地关键帧。`);
  }
  await assertReadableLocalImage(keyframeUrl, shot.index);
  return {
    id: shot.id,
    durationSec: shot.durationSec,
    keyframeUrl,
    subtitle: shot.subtitle,
    title: shot.goal,
    keywords: extractShotKeywords(shot, sellingPoints)
  };
}

export function extractShotKeywords(shot: Pick<StoryboardShot, "subtitle" | "goal">, sellingPoints: string[] = []) {
  const candidates = [...sellingPoints, shot.subtitle, shot.goal]
    .flatMap((value) => value.split(/[，。！？、/|｜]/))
    .map((value) => value.trim())
    .map((value) => value.replace(/^(低糖|冷萃|轻负担)[:：]?/, "$1"))
    .filter((value) => value.length >= 2 && value.length <= 10);

  return [...new Set(candidates)].slice(0, 3);
}

async function collectReadableProductAssets(project: GenerationProject): Promise<AdCompositionProps["productAssets"]> {
  const images = project.brief.productImages ?? [];
  const result: AdCompositionProps["productAssets"] = [];

  for (const image of images) {
    const url = stripQuery(image.localUrl || image.url || "");
    if (!url || isForbiddenRenderUrl(url)) continue;
    try {
      await assertReadableLocalImage(url);
      result.push({ url, role: image.role });
    } catch {
      // Product image is optional; Shot 4 keyframe remains the fallback end card.
    }
  }

  return result;
}

async function assertReadableLocalImage(url: string, shotIndex?: number) {
  const filePath = localPublicPath(url);
  const bytes = await readFile(filePath).catch(() => null);
  if (!bytes || bytes.length < 12 || !isSupportedImage(bytes)) {
    const target = shotIndex ? `镜头 ${shotIndex}` : "产品图";
    throw new RenderProjectError("KEYFRAME_MISSING", `${target} 的本地图片不存在或不可读。`);
  }
}

async function assertReadableLocalAudio(url: string) {
  const filePath = localPublicPath(url);
  const info = await stat(filePath).catch(() => null);
  if (!info || !info.isFile() || info.size <= 0 || !/\.(mp3|wav|m4a|aac)$/i.test(filePath)) {
    throw new RenderProjectError("MEDIA_UNREADABLE", "旁白音频不存在、为空或格式不受支持。");
  }
}

async function assertReadableLocalVideo(url: string) {
  const filePath = localPublicPath(url);
  const info = await stat(filePath).catch(() => null);
  if (!info || !info.isFile() || info.size <= 0) {
    throw new RenderProjectError("HERO_VIDEO_MISSING", "主镜头视频文件不存在或为空。");
  }
  const bytes = await readFile(filePath).catch(() => null);
  if (!bytes || bytes.length < 12 || bytes.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw new RenderProjectError("MEDIA_UNREADABLE", "主镜头视频不是可读取的 MP4 文件。");
  }
}

export function localPublicPath(url: string) {
  const cleanUrl = stripQuery(url);
  if (!cleanUrl.startsWith("/") || cleanUrl.includes("..") || isForbiddenRenderUrl(cleanUrl)) {
    throw new RenderProjectError("MEDIA_UNREADABLE", "渲染只允许使用本地持久化媒体文件。");
  }
  return path.join(process.cwd(), "public", decodeURIComponent(cleanUrl.replace(/^\//, "")));
}

function stripQuery(url: string) {
  return url.split("?")[0]?.trim() ?? "";
}

function isSupportedImage(bytes: Buffer) {
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return png || jpg || webp;
}





