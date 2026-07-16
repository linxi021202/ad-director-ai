import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  MAX_HERO_VIDEO_DURATION_SEC,
  MAX_HERO_VIDEO_SIZE,
  MIN_HERO_VIDEO_DURATION_SEC
} from "./heroVideo";
import type { AspectRatio } from "./schemas/project";

export const heroVideoAssetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  shotId: z.string().min(1),
  source: z.enum(["happyhorse-manual-import", "happyhorse-api"]),
  fileName: z.string().min(1),
  mimeType: z.literal("video/mp4"),
  sizeBytes: z.number().int().positive(),
  durationSec: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.string().min(1),
  localPath: z.string().min(1),
  publicUrl: z.string().min(1),
  createdAt: z.string().datetime()
});

export const heroVideoProjectStateSchema = z.object({
  projectId: z.string().min(1),
  heroShotId: z.string().min(1).nullable(),
  heroVideoAsset: heroVideoAssetSchema.nullable(),
  updatedAt: z.string().datetime()
});

export type HeroVideoAsset = z.infer<typeof heroVideoAssetSchema>;
export type HeroVideoProjectState = z.infer<typeof heroVideoProjectStateSchema>;

export type HeroVideoUploadInput = {
  projectId: string;
  shotId: string;
  aspectRatio: AspectRatio;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  source?: "happyhorse-manual-import" | "happyhorse-api";
};

export type HeroVideoUploadResult =
  | { success: true; asset: HeroVideoAsset }
  | { success: false; error: string; status: number };

const DATA_DIR = path.join(process.cwd(), "data", "projects");
const PUBLIC_GENERATED_DIR = path.join(process.cwd(), "public", "generated");

export async function readHeroVideoProjectState(projectId: string): Promise<HeroVideoProjectState> {
  const safeProjectId = safeSegment(projectId, "project");
  try {
    const raw = await readFile(projectStatePath(safeProjectId), "utf8");
    const parsed = heroVideoProjectStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Missing local state is expected for a fresh demo project.
  }

  return {
    projectId: safeProjectId,
    heroShotId: null,
    heroVideoAsset: null,
    updatedAt: new Date().toISOString()
  };
}

export async function writeHeroShotState(projectId: string, heroShotId: string | null) {
  const safeProjectId = safeSegment(projectId, "project");
  const state = await readHeroVideoProjectState(safeProjectId);
  await writeHeroVideoProjectState(safeProjectId, { ...state, heroShotId, updatedAt: new Date().toISOString() });
}

export async function saveHeroVideoAsset(input: HeroVideoUploadInput): Promise<HeroVideoUploadResult> {
  const projectId = safeSegment(input.projectId, "project");
  const shotId = safeSegment(input.shotId, "shot");
  const fileName = input.fileName.trim();

  if (!fileName.toLowerCase().endsWith(".mp4")) return fail("仅支持 .mp4 视频文件。", 400);
  if (input.mimeType !== "video/mp4") return fail("仅支持 video/mp4 视频文件。", 400);
  if (input.sizeBytes <= 0) return fail("视频文件为空。", 400);
  if (input.sizeBytes > MAX_HERO_VIDEO_SIZE) return fail("单个视频不能超过 50MB。", 413);
  if (!hasMp4Signature(input.buffer)) return fail("视频文件头不是有效 MP4。", 400);

  const metadata = parseMp4Metadata(input.buffer);
  if (!metadata) return fail("无法读取 MP4 视频元数据。", 400);
  if (metadata.width <= 0 || metadata.height <= 0) return fail("无法读取视频宽高。", 400);
  if (metadata.durationSec < MIN_HERO_VIDEO_DURATION_SEC) return fail("主镜头视频时长不能短于 3 秒。", 400);
  if (metadata.durationSec > MAX_HERO_VIDEO_DURATION_SEC) return fail("主镜头视频时长不能超过 8 秒。", 400);
  const isManualImport = (input.source ?? "happyhorse-manual-import") === "happyhorse-manual-import";
  if (isManualImport && !matchesAspectDirection(metadata.width, metadata.height, input.aspectRatio)) {
    return fail("上传视频画幅与当前项目设置不一致。", 400);
  }

  const dir = path.join(PUBLIC_GENERATED_DIR, projectId, "video");
  const tempPath = path.join(dir, "hero-shot.uploading.mp4");
  const finalPath = path.join(dir, "hero-shot.mp4");
  await mkdir(dir, { recursive: true });

  try {
    await writeFile(tempPath, input.buffer);
    await rename(tempPath, finalPath);
  } catch {
    await rm(tempPath, { force: true }).catch(() => undefined);
    return fail("主镜头视频保存失败，旧视频已保留。", 500);
  }

  const now = new Date().toISOString();
  const asset: HeroVideoAsset = {
    id: `${projectId}-${shotId}-hero-video`,
    projectId,
    shotId,
    source: input.source ?? "happyhorse-manual-import",
    fileName: "hero-shot.mp4",
    mimeType: "video/mp4",
    sizeBytes: input.sizeBytes,
    durationSec: metadata.durationSec,
    width: metadata.width,
    height: metadata.height,
    aspectRatio: input.aspectRatio,
    localPath: `public/generated/${projectId}/video/hero-shot.mp4`,
    publicUrl: `/generated/${projectId}/video/hero-shot.mp4`,
    createdAt: now
  };

  await writeHeroVideoProjectState(projectId, {
    projectId,
    heroShotId: shotId,
    heroVideoAsset: asset,
    updatedAt: now
  });

  return { success: true, asset };
}

export async function deleteHeroVideoAsset(projectId: string) {
  const safeProjectId = safeSegment(projectId, "project");
  const state = await readHeroVideoProjectState(safeProjectId);
  const finalPath = path.join(PUBLIC_GENERATED_DIR, safeProjectId, "video", "hero-shot.mp4");
  await rm(finalPath, { force: true }).catch(() => undefined);
  await writeHeroVideoProjectState(safeProjectId, {
    ...state,
    heroVideoAsset: null,
    updatedAt: new Date().toISOString()
  });
}

export async function heroVideoFileExists(asset: HeroVideoAsset | null) {
  if (!asset) return false;
  try {
    await stat(path.join(process.cwd(), asset.localPath));
    return true;
  } catch {
    return false;
  }
}

export function getHeroShotWorkflowStatus(input: { hasHeroShot: boolean; hasVideo: boolean; uploading?: boolean; error?: string | null }) {
  if (!input.hasHeroShot) return "blocked" as const;
  if (input.error) return "failed" as const;
  if (input.uploading) return "running" as const;
  if (input.hasVideo) return "completed" as const;
  return "waiting-manual-import" as const;
}

export function heroShotWorkflowStatusLabel(status: ReturnType<typeof getHeroShotWorkflowStatus>) {
  const labels: Record<ReturnType<typeof getHeroShotWorkflowStatus>, string> = {
    blocked: "请先选择主镜头",
    "waiting-manual-import": "等待导入视频",
    running: "正在上传",
    completed: "主镜头已就绪",
    failed: "上传失败"
  };
  return labels[status];
}

export function sanitizeHeroVideoAssetForClient(asset: HeroVideoAsset | null) {
  return asset;
}

export function safeSegment(value: string, fallback = "asset") {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return safe || fallback;
}

function projectStatePath(projectId: string) {
  return path.join(DATA_DIR, `${projectId}.json`);
}

async function writeHeroVideoProjectState(projectId: string, state: HeroVideoProjectState) {
  await mkdir(DATA_DIR, { recursive: true });
  const safeState = heroVideoProjectStateSchema.parse(state);
  await writeFile(projectStatePath(projectId), JSON.stringify(safeState, null, 2), "utf8");
}

function fail(error: string, status: number): HeroVideoUploadResult {
  return { success: false, error, status };
}

function hasMp4Signature(buffer: Buffer) {
  if (buffer.length < 12) return false;
  return buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

function parseMp4Metadata(buffer: Buffer): { durationSec: number; width: number; height: number } | null {
  const mvhd = findAtom(buffer, "mvhd");
  const tkhdAtoms = findAtoms(buffer, "tkhd");
  if (!mvhd || tkhdAtoms.length === 0) return null;

  const durationSec = readMvhdDuration(buffer, mvhd.offset + mvhd.headerSize, mvhd.size - mvhd.headerSize);
  const dimensions = tkhdAtoms
    .map((atom) => readTkhdDimensions(buffer, atom.offset + atom.headerSize, atom.size - atom.headerSize))
    .filter((item): item is { width: number; height: number } => Boolean(item && item.width > 0 && item.height > 0))
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];

  if (!durationSec || !dimensions) return null;
  return { durationSec, width: dimensions.width, height: dimensions.height };
}

type AtomInfo = { offset: number; size: number; headerSize: number; type: string };

function findAtom(buffer: Buffer, target: string) {
  return findAtoms(buffer, target)[0] ?? null;
}

function findAtoms(buffer: Buffer, target: string, start = 0, end = buffer.length): AtomInfo[] {
  const result: AtomInfo[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    let size = size32;
    let headerSize = 8;

    if (size32 === 1) {
      if (offset + 16 > end) break;
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) break;
    if (type === target) result.push({ offset, size, headerSize, type });

    if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) {
      result.push(...findAtoms(buffer, target, offset + headerSize, offset + size));
    }
    offset += size;
  }
  return result;
}

function readMvhdDuration(buffer: Buffer, contentOffset: number, contentSize: number) {
  if (contentSize < 24) return null;
  const version = buffer.readUInt8(contentOffset);
  if (version === 1) {
    if (contentSize < 36) return null;
    const timescale = buffer.readUInt32BE(contentOffset + 20);
    const duration = buffer.readBigUInt64BE(contentOffset + 24);
    if (!timescale) return null;
    return Number(duration) / timescale;
  }

  const timescale = buffer.readUInt32BE(contentOffset + 12);
  const duration = buffer.readUInt32BE(contentOffset + 16);
  if (!timescale) return null;
  return duration / timescale;
}

function readTkhdDimensions(buffer: Buffer, contentOffset: number, contentSize: number) {
  if (contentSize < 84) return null;
  const version = buffer.readUInt8(contentOffset);
  const dimensionOffset = contentOffset + (version === 1 ? 88 : 76);
  if (dimensionOffset + 8 > contentOffset + contentSize) return null;
  return {
    width: Math.round(buffer.readUInt32BE(dimensionOffset) / 65536),
    height: Math.round(buffer.readUInt32BE(dimensionOffset + 4) / 65536)
  };
}

function matchesAspectDirection(width: number, height: number, aspectRatio: AspectRatio) {
  if (aspectRatio === "9:16") return height > width;
  if (aspectRatio === "16:9") return width > height;
  const ratio = width / height;
  return ratio >= 0.9 && ratio <= 1.1;
}







