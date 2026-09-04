import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { requireOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import {
  assertAssetId,
  getStorageRoot,
  resolveAssetFilePath,
  resolveAssetManifestPath,
  resolveStorageRelativePath,
  sanitizeStorageFileName,
  toStorageRelativePath
} from "./path";
import {
  projectAssetManifestSchema,
  projectAssetRecordSchema,
  type ProjectAssetKind,
  type ProjectAssetLifecycle,
  type ProjectAssetManifest,
  type ProjectAssetRecord,
  type ProjectAssetSource,
  type PublicProjectAsset
} from "./types";

export type CreatePrivateAssetInput = {
  assetId?: string;
  kind: ProjectAssetKind;
  role?: string;
  source: ProjectAssetSource;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  durationSec?: number;
};

export type ImportPrivateAssetInput = Omit<CreatePrivateAssetInput, "bytes"> & {
  sourcePath: string;
};

const manifestWriteQueues = new Map<string, Promise<void>>();

export async function createPrivateAsset(
  sessionId: string,
  projectId: string,
  input: CreatePrivateAssetInput
): Promise<ProjectAssetRecord> {
  await requireOwnedAnonymousProject(sessionId, projectId);
  if (input.bytes.byteLength <= 0) throw new Error("ASSET_FILE_EMPTY");

  const assetId = input.assetId ? assertAssetId(input.assetId) : randomUUID();
  const storageName = stableStorageName(input.fileName, input.mimeType);
  const destination = resolveAssetFilePath(sessionId, projectId, assetId, storageName);
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await mkdir(path.dirname(destination), { recursive: true });

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(input.bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  try {
    return await registerAssetRecord(sessionId, projectId, input, assetId, destination, input.bytes.byteLength,
      createHash("sha256").update(input.bytes).digest("hex"));
  } catch (error) {
    await rm(path.dirname(destination), { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function importPrivateAssetFile(
  sessionId: string,
  projectId: string,
  input: ImportPrivateAssetInput
): Promise<ProjectAssetRecord> {
  await requireOwnedAnonymousProject(sessionId, projectId);
  const sourceInfo = await stat(input.sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error("ASSET_FILE_EMPTY");

  const assetId = input.assetId ? assertAssetId(input.assetId) : randomUUID();
  const destination = resolveAssetFilePath(sessionId, projectId, assetId, stableStorageName(input.fileName, input.mimeType));
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(input.sourcePath, temporary);
  await rename(temporary, destination);

  try {
    const bytes = await readFile(destination);
    return await registerAssetRecord(sessionId, projectId, input, assetId, destination, bytes.length,
      createHash("sha256").update(bytes).digest("hex"));
  } catch (error) {
    await rm(path.dirname(destination), { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function listPrivateAssets(sessionId: string, projectId: string): Promise<ProjectAssetRecord[]> {
  await requireOwnedAnonymousProject(sessionId, projectId);
  return (await readManifest(sessionId, projectId)).assets;
}

export async function getPrivateAsset(
  sessionId: string,
  projectId: string,
  assetId: string
): Promise<ProjectAssetRecord | null> {
  await requireOwnedAnonymousProject(sessionId, projectId);
  if (!safeAssetId(assetId)) return null;
  const manifest = await readManifest(sessionId, projectId);
  return manifest.assets.find((asset) => asset.id === assetId && asset.projectId === projectId) ?? null;
}

export async function requirePrivateAsset(
  sessionId: string,
  projectId: string,
  assetId: string
): Promise<ProjectAssetRecord> {
  const asset = await getPrivateAsset(sessionId, projectId, assetId);
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  return asset;
}

export async function deletePrivateAsset(sessionId: string, projectId: string, assetId: string): Promise<void> {
  await requireOwnedAnonymousProject(sessionId, projectId);
  if (!safeAssetId(assetId)) return;
  await withManifestQueue(sessionId, projectId, async () => {
    const manifest = await readManifest(sessionId, projectId);
    const asset = manifest.assets.find((item) => item.id === assetId);
    if (!asset) return;
    await writeManifestAtomic(sessionId, projectId, {
      version: 1,
      assets: manifest.assets.filter((item) => item.id !== assetId)
    });
    await rm(path.dirname(resolveStorageRelativePath(asset.storageRelativePath)), { recursive: true, force: true });
  });
}

export async function markPrivateAssetsLifecycle(
  sessionId: string,
  projectId: string,
  assetIds: string[],
  lifecycle: ProjectAssetLifecycle
): Promise<void> {
  await requireOwnedAnonymousProject(sessionId, projectId);
  const requestedIds = new Set(assetIds.filter(safeAssetId));
  if (requestedIds.size === 0) return;

  await withManifestQueue(sessionId, projectId, async () => {
    const manifest = await readManifest(sessionId, projectId);
    const now = new Date().toISOString();
    const assets = manifest.assets.map((asset) => requestedIds.has(asset.id)
      ? { ...asset, lifecycle, updatedAt: now }
      : asset);
    await writeManifestAtomic(sessionId, projectId, { version: 1, assets });
  });
}
export function resolvePrivateAssetFile(asset: ProjectAssetRecord): string {
  return resolveStorageRelativePath(asset.storageRelativePath);
}

export async function assertPrivateAssetReadable(asset: ProjectAssetRecord): Promise<string> {
  const filePath = resolvePrivateAssetFile(asset);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size !== asset.sizeBytes || info.size <= 0) throw new Error("ASSET_FILE_UNREADABLE");
  return filePath;
}

export function toPublicProjectAsset(asset: ProjectAssetRecord): PublicProjectAsset {
  const { storageRelativePath: _path, checksumSha256: _checksum, ...safe } = asset;
  return { ...safe, url: getProjectAssetUrl(asset.projectId, asset.id) };
}

export function getProjectAssetUrl(projectId: string, assetId: string, download = false): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`;
  return download ? `${base}?download=1` : base;
}

export function resetAssetStoreForTests(): void {
  manifestWriteQueues.clear();
}

async function registerAssetRecord(
  sessionId: string,
  projectId: string,
  input: Omit<CreatePrivateAssetInput, "bytes">,
  assetId: string,
  destination: string,
  sizeBytes: number,
  checksumSha256: string
): Promise<ProjectAssetRecord> {
  const now = new Date().toISOString();
  const record = projectAssetRecordSchema.parse({
    id: assetId,
    projectId,
    kind: input.kind,
    ...(input.role ? { role: input.role } : {}),
    source: input.source,
    fileName: sanitizeStorageFileName(input.fileName),
    storageRelativePath: toStorageRelativePath(destination),
    mimeType: input.mimeType,
    sizeBytes,
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.durationSec ? { durationSec: input.durationSec } : {}),
    checksumSha256,
    createdAt: now,
    updatedAt: now
  });

  await withManifestQueue(sessionId, projectId, async () => {
    const manifest = await readManifest(sessionId, projectId);
    const previous = manifest.assets.find((asset) => asset.id === assetId);
    const next = projectAssetManifestSchema.parse({
      version: 1,
      assets: [...manifest.assets.filter((asset) => asset.id !== assetId), {
        ...record,
        createdAt: previous?.createdAt ?? record.createdAt
      }]
    });
    await writeManifestAtomic(sessionId, projectId, next);
  });
  return record;
}

async function readManifest(sessionId: string, projectId: string): Promise<ProjectAssetManifest> {
  try {
    const raw = await readFile(resolveAssetManifestPath(sessionId, projectId), "utf8");
    return projectAssetManifestSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFile(error)) return { version: 1, assets: [] };
    throw error;
  }
}

async function writeManifestAtomic(sessionId: string, projectId: string, manifest: ProjectAssetManifest): Promise<void> {
  const destination = resolveAssetManifestPath(sessionId, projectId);
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await mkdir(path.dirname(destination), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(projectAssetManifestSchema.parse(manifest), null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function withManifestQueue<T>(sessionId: string, projectId: string, operation: () => Promise<T>): Promise<T> {
  const key = `${sessionId}:${projectId}`;
  const previous = manifestWriteQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  manifestWriteQueues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (manifestWriteQueues.get(key) === queued) manifestWriteQueues.delete(key);
  }
}

function stableStorageName(fileName: string, mimeType: string): string {
  const extension = extensionFor(fileName, mimeType);
  return `source-file${extension ? `.${extension}` : ""}`;
}

function extensionFor(fileName: string, mimeType: string): string {
  const byMime: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/mp4": "m4a", "audio/aac": "aac"
  };
  return byMime[mimeType] ?? path.extname(fileName).replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function safeAssetId(value: string): boolean {
  try { assertAssetId(value); return true; } catch { return false; }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
