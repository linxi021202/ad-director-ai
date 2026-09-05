import "server-only";

import {
  assertPrivateAssetReadable,
  listPrivateAssets
} from "@/lib/assets/assetStore";
import type { ProjectAssetKind, ProjectAssetSource } from "@/lib/assets/types";
import { listAnonymousProjects } from "@/lib/projects/anonymousProjectStore";

const videoKinds = new Set<ProjectAssetKind>(["hero-video", "final-video"]);

export type VideoLibraryItem = {
  id: string;
  projectId: string;
  projectName: string;
  kind: "hero-video" | "final-video";
  source: ProjectAssetSource;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  createdAt: string;
  url: string;
  downloadUrl: string;
};

export async function listSessionVideoLibrary(sessionId: string): Promise<VideoLibraryItem[]> {
  const projects = await listAnonymousProjects(sessionId);
  const groups = await Promise.all(projects.map(async (record) => {
    const assets = await listPrivateAssets(sessionId, record.id);
    const videos = await Promise.all(assets
      .filter((asset) => videoKinds.has(asset.kind) && asset.lifecycle !== "pending-cleanup")
      .map(async (asset): Promise<VideoLibraryItem | null> => {
        const readable = await assertPrivateAssetReadable(asset).then(() => true).catch(() => false);
        if (!readable || (asset.kind !== "hero-video" && asset.kind !== "final-video")) return null;
        const base = `/api/video-library/${encodeURIComponent(record.id)}/${encodeURIComponent(asset.id)}`;
        return {
          id: asset.id,
          projectId: record.id,
          projectName: record.project.brief.productName,
          kind: asset.kind,
          source: asset.source,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          width: asset.width,
          height: asset.height,
          durationSec: asset.durationSec,
          createdAt: asset.createdAt,
          url: base,
          downloadUrl: `${base}?download=1`
        } satisfies VideoLibraryItem;
      }));
    return videos.filter((item): item is VideoLibraryItem => Boolean(item));
  }));

  return groups.flat().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function isVideoLibraryAsset(kind: ProjectAssetKind) {
  return videoKinds.has(kind);
}
