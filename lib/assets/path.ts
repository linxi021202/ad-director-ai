import "server-only";

import { createHash } from "node:crypto";
import path from "node:path";

import { anonymousProjectIdSchema } from "@/lib/projects/anonymousProjectStore";

const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getStorageRoot(): string {
  return path.resolve(process.env.STORAGE_ROOT?.trim() || path.join(process.cwd(), "storage"));
}

export function getSessionStorageNamespace(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

export function assertAssetId(assetId: string): string {
  if (!ASSET_ID_PATTERN.test(assetId)) throw new Error("INVALID_ASSET_ID");
  return assetId;
}

export function resolvePrivateProjectDirectory(sessionId: string, projectId: string): string {
  const safeProjectId = anonymousProjectIdSchema.parse(projectId);
  return resolveInsideStorage(
    "sessions",
    getSessionStorageNamespace(sessionId),
    "projects",
    safeProjectId
  );
}

export function resolveAssetManifestPath(sessionId: string, projectId: string): string {
  return resolveInsideStorage(resolvePrivateProjectDirectory(sessionId, projectId), "assets.json");
}

export function resolveAssetDirectory(sessionId: string, projectId: string, assetId: string): string {
  return resolveInsideStorage(resolvePrivateProjectDirectory(sessionId, projectId), "assets", assertAssetId(assetId));
}

export function resolveAssetFilePath(
  sessionId: string,
  projectId: string,
  assetId: string,
  fileName: string
): string {
  const safeName = sanitizeStorageFileName(fileName);
  return resolveInsideStorage(resolveAssetDirectory(sessionId, projectId, assetId), safeName);
}

export function toStorageRelativePath(absolutePath: string): string {
  const root = getStorageRoot();
  const safe = assertInsideRoot(root, absolutePath);
  return path.relative(root, safe).split(path.sep).join("/");
}

export function resolveStorageRelativePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("UNSAFE_ASSET_STORAGE_PATH");
  }
  return resolveInsideStorage(...relativePath.split(/[\\/]+/));
}

export function sanitizeStorageFileName(fileName: string): string {
  const base = path.basename(fileName).normalize("NFKC");
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 180);
  if (!safe || safe === "." || safe === "..") throw new Error("UNSAFE_ASSET_FILE_NAME");
  return safe;
}

export function resolveInsideStorage(...segments: string[]): string {
  const root = getStorageRoot();
  const candidate = path.resolve(root, ...segments);
  return assertInsideRoot(root, candidate);
}

function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("UNSAFE_ASSET_STORAGE_PATH");
  }
  return resolvedCandidate;
}
