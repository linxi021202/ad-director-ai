import "server-only";

import { randomBytes } from "node:crypto";

import { assertPrivateAssetReadable, requirePrivateAsset } from "./assetStore";

const DEFAULT_RENDER_TOKEN_TTL_MS = 15 * 60 * 1000;

type RenderAssetGrant = {
  projectId: string;
  renderId: string;
  expiresAt: number;
  assets: Map<string, { filePath: string; mimeType: string; sizeBytes: number; fileName: string }>;
};

const grants = new Map<string, RenderAssetGrant>();

export async function issueRenderAssetToken(input: {
  sessionId: string;
  projectId: string;
  renderId: string;
  assetIds: string[];
  ttlMs?: number;
}): Promise<string> {
  const assets = new Map<string, { filePath: string; mimeType: string; sizeBytes: number; fileName: string }>();
  for (const assetId of [...new Set(input.assetIds)]) {
    const asset = await requirePrivateAsset(input.sessionId, input.projectId, assetId);
    const filePath = await assertPrivateAssetReadable(asset);
    assets.set(asset.id, { filePath, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, fileName: asset.fileName });
  }
  const token = randomBytes(32).toString("base64url");
  grants.set(token, {
    projectId: input.projectId,
    renderId: input.renderId,
    expiresAt: Date.now() + Math.max(30_000, input.ttlMs ?? DEFAULT_RENDER_TOKEN_TTL_MS),
    assets
  });
  pruneExpiredRenderTokens();
  return token;
}

export function resolveRenderAssetGrant(token: string, assetId: string) {
  const grant = grants.get(token);
  if (!grant || grant.expiresAt <= Date.now()) {
    if (grant) grants.delete(token);
    return null;
  }
  const asset = grant.assets.get(assetId);
  return asset ? { ...asset, projectId: grant.projectId, renderId: grant.renderId } : null;
}

export function revokeRenderAssetToken(token: string): void {
  grants.delete(token);
}

export function getInternalRenderAssetUrl(origin: string, assetId: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/api/internal/render-assets/${encodeURIComponent(assetId)}?token=${encodeURIComponent(token)}`;
}

export function resetRenderAssetTokensForTests(): void {
  grants.clear();
}

function pruneExpiredRenderTokens(): void {
  const now = Date.now();
  for (const [token, grant] of grants) if (grant.expiresAt <= now) grants.delete(token);
}
