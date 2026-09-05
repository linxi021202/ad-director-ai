import "server-only";

import { z } from "zod";

import {
  assertPrivateAssetReadable,
  createPrivateAsset,
  deletePrivateAsset,
  getPrivateAsset,
  getProjectAssetUrl,
  markPrivateAssetsLifecycle
} from "./assets/assetStore";
import { hasMp4Signature } from "./assets/media";
import { MAX_HERO_VIDEO_DURATION_SEC, MAX_HERO_VIDEO_SIZE, MIN_HERO_VIDEO_DURATION_SEC } from "./heroVideo";
import {
  requireOwnedAnonymousProject,
  updateOwnedAnonymousProject
} from "./projects/anonymousProjectStore";
import type { AspectRatio } from "./schemas/project";

export const heroVideoAssetSchema = z.object({
  assetId: z.string().uuid(),
  projectId: z.string().uuid(),
  shotId: z.string().min(1),
  source: z.enum(["user-upload", "wan-api", "happyhorse-manual-import", "happyhorse-api"]),
  fileName: z.string().min(1),
  mimeType: z.literal("video/mp4"),
  sizeBytes: z.number().int().positive(),
  durationSec: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.string().min(1),
  publicUrl: z.string().min(1),
  createdAt: z.string().datetime()
});

export const heroVideoProjectStateSchema = z.object({
  projectId: z.string().uuid(),
  heroShotId: z.string().min(1).nullable(),
  heroVideoAsset: heroVideoAssetSchema.nullable(),
  updatedAt: z.string().datetime()
});

export type HeroVideoAsset = z.infer<typeof heroVideoAssetSchema>;
export type HeroVideoProjectState = z.infer<typeof heroVideoProjectStateSchema>;

export type HeroVideoUploadInput = {
  sessionId: string;
  projectId: string;
  shotId: string;
  aspectRatio: AspectRatio;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  source?: "user-upload" | "wan-api" | "happyhorse-manual-import" | "happyhorse-api";
};

export type HeroVideoUploadResult =
  | { success: true; asset: HeroVideoAsset }
  | { success: false; error: string; status: number };

export async function readHeroVideoProjectState(sessionId: string, projectId: string): Promise<HeroVideoProjectState> {
  const record = await requireOwnedAnonymousProject(sessionId, projectId);
  const metadata = record.project.heroVideo;
  if (!metadata?.assetId) {
    return {
      projectId: record.id,
      heroShotId: record.project.heroShotId ?? null,
      heroVideoAsset: null,
      updatedAt: record.project.updatedAt
    };
  }
  const stored = await getPrivateAsset(sessionId, projectId, metadata.assetId);
  if (!stored || stored.kind !== "hero-video") {
    return {
      projectId: record.id,
      heroShotId: record.project.heroShotId ?? null,
      heroVideoAsset: null,
      updatedAt: record.project.updatedAt
    };
  }
  return {
    projectId: record.id,
    heroShotId: record.project.heroShotId ?? null,
    heroVideoAsset: heroVideoAssetSchema.parse({
      assetId: stored.id,
      projectId: record.id,
      shotId: metadata.shotId,
      source: metadata.source,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      durationSec: stored.durationSec,
      width: stored.width,
      height: stored.height,
      aspectRatio: metadata.aspectRatio ?? record.project.brief.aspectRatio,
      publicUrl: getProjectAssetUrl(record.id, stored.id),
      createdAt: stored.createdAt
    }),
    updatedAt: record.project.updatedAt
  };
}

export async function writeHeroShotState(sessionId: string, projectId: string, heroShotId: string | null) {
  if (!heroShotId) return;
  await updateOwnedAnonymousProject(sessionId, projectId, { heroShotId });
}

export async function saveHeroVideoAsset(input: HeroVideoUploadInput): Promise<HeroVideoUploadResult> {
  const fileName = input.fileName.trim();
  if (!fileName.toLowerCase().endsWith(".mp4")) return fail("仅支持 .mp4 视频文件。", 400);
  if (input.mimeType !== "video/mp4") return fail("仅支持 video/mp4 视频文件。", 400);
  if (input.sizeBytes <= 0) return fail("视频文件为空。", 400);
  if (input.sizeBytes > MAX_HERO_VIDEO_SIZE) return fail("单个视频不能超过 50MB。", 413);
  if (!hasMp4Signature(input.buffer)) return fail("视频文件头不是有效 MP4。", 400);

  const metadata = parseMp4Metadata(input.buffer);
  if (!metadata) return fail("无法读取 MP4 视频元数据。", 400);
  const source = input.source ?? "user-upload";
  const isGeneratedShot = source === "wan-api" || source === "happyhorse-api";
  if (isGeneratedShot && metadata.durationSec < MIN_HERO_VIDEO_DURATION_SEC) {
    return fail(`AI 生成视频时长不能短于 ${MIN_HERO_VIDEO_DURATION_SEC} 秒。`, 400);
  }
  if (isGeneratedShot && metadata.durationSec > MAX_HERO_VIDEO_DURATION_SEC) {
    return fail(`AI 生成视频时长不能超过 ${MAX_HERO_VIDEO_DURATION_SEC} 秒。`, 400);
  }

  try {
    const record = await requireOwnedAnonymousProject(input.sessionId, input.projectId);
    const configuredHeroShot = record.project.shots.find((shot) => shot.id === input.shotId);
    if (!configuredHeroShot) {
      return fail("HERO_VIDEO_DURATION_MISMATCH：当前视频对应的主镜头已失效，请重新选择主镜头。", 409);
    }
    if (isGeneratedShot && Math.abs(metadata.durationSec - configuredHeroShot.durationSec) > 0.75) {
      return fail(
        "HERO_VIDEO_DURATION_MISMATCH：当前视频时长与主镜头设定不一致。主镜头需要 "
          + configuredHeroShot.durationSec
          + " 秒，上传视频实际为 "
          + metadata.durationSec.toFixed(1)
          + " 秒。",
        422
      );
    }
    const previousAssetId = record.project.heroVideo?.assetId;
    const stored = await createPrivateAsset(input.sessionId, input.projectId, {
      kind: "hero-video",
      role: input.shotId,
      source,
      fileName,
      mimeType: "video/mp4",
      bytes: input.buffer,
      width: metadata.width,
      height: metadata.height,
      durationSec: metadata.durationSec
    });
    const asset = heroVideoAssetSchema.parse({
      assetId: stored.id,
      projectId: input.projectId,
      shotId: input.shotId,
      source,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      durationSec: stored.durationSec,
      width: stored.width,
      height: stored.height,
      aspectRatio: input.aspectRatio,
      publicUrl: getProjectAssetUrl(input.projectId, stored.id),
      createdAt: stored.createdAt
    });
    try {
      await updateOwnedAnonymousProject(input.sessionId, input.projectId, {
        heroShotId: input.shotId,
        heroVideo: {
          shotId: input.shotId,
          assetId: stored.id,
          source,
          status: "uploaded",
          url: asset.publicUrl,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          durationSec: stored.durationSec,
          aspectRatio: input.aspectRatio,
          storageTransition: "PRIVATE_ASSET_V1"
        },
        workflowSteps: {
          ...(record.project.workflowSteps ?? defaultWorkflow()),
          heroShot: "completed",
          render: "pending"
        }
      });
    } catch (error) {
      await deletePrivateAsset(input.sessionId, input.projectId, stored.id);
      throw error;
    }
    if (previousAssetId && previousAssetId !== stored.id) {
      await markPrivateAssetsLifecycle(input.sessionId, input.projectId, [previousAssetId], "orphaned").catch(() => undefined);
    }
    return { success: true, asset };
  } catch {
    return fail("广告视频私有保存失败，原视频未被覆盖。", 500);
  }
}

export async function deleteHeroVideoAsset(sessionId: string, projectId: string) {
  const record = await requireOwnedAnonymousProject(sessionId, projectId);
  const assetId = record.project.heroVideo?.assetId;
  await updateOwnedAnonymousProject(sessionId, projectId, {
    heroVideo: null,
    workflowSteps: {
      ...(record.project.workflowSteps ?? defaultWorkflow()),
      heroShot: "pending",
      render: "pending"
    }
  });
  if (assetId) await markPrivateAssetsLifecycle(sessionId, projectId, [assetId], "orphaned");
}

export async function heroVideoFileExists(sessionId: string, asset: HeroVideoAsset | null) {
  if (!asset) return false;
  try {
    const stored = await getPrivateAsset(sessionId, asset.projectId, asset.assetId);
    if (!stored) return false;
    await assertPrivateAssetReadable(stored);
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
  return {
    blocked: "请先选择主镜头",
    "waiting-manual-import": "等待导入视频",
    running: "正在上传",
    completed: "主镜头已就绪",
    failed: "上传失败"
  }[status];
}

export function sanitizeHeroVideoAssetForClient(asset: HeroVideoAsset | null) {
  return asset;
}

export function safeSegment(value: string, fallback = "asset") {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return safe || fallback;
}

function fail(error: string, status: number): HeroVideoUploadResult {
  return { success: false, error, status };
}

function parseMp4Metadata(buffer: Buffer): { durationSec: number; width: number; height: number } | null {
  const mvhd = findAtoms(buffer, "mvhd")[0];
  const tkhdAtoms = findAtoms(buffer, "tkhd");
  if (!mvhd || tkhdAtoms.length === 0) return null;
  const durationSec = readMvhdDuration(buffer, mvhd.offset + mvhd.headerSize, mvhd.size - mvhd.headerSize);
  const dimensions = tkhdAtoms
    .map((atom) => readTkhdDimensions(buffer, atom.offset + atom.headerSize, atom.size - atom.headerSize))
    .filter((item): item is { width: number; height: number } => Boolean(item && item.width > 0 && item.height > 0))
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return durationSec && dimensions ? { durationSec, ...dimensions } : null;
}

type AtomInfo = { offset: number; size: number; headerSize: number; type: string };

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
    return timescale ? Number(duration) / timescale : null;
  }
  const timescale = buffer.readUInt32BE(contentOffset + 12);
  return timescale ? buffer.readUInt32BE(contentOffset + 16) / timescale : null;
}

function readTkhdDimensions(buffer: Buffer, contentOffset: number, contentSize: number) {
  if (contentSize < 84) return null;
  const dimensionOffset = contentOffset + (buffer.readUInt8(contentOffset) === 1 ? 88 : 76);
  if (dimensionOffset + 8 > contentOffset + contentSize) return null;
  return {
    width: Math.round(buffer.readUInt32BE(dimensionOffset) / 65536),
    height: Math.round(buffer.readUInt32BE(dimensionOffset + 4) / 65536)
  };
}

function defaultWorkflow() {
  return {
    brief: "completed" as const,
    strategy: "completed" as const,
    storyboard: "completed" as const,
    keyframes: "completed" as const,
    heroShot: "pending" as const,
    render: "pending" as const
  };
}
