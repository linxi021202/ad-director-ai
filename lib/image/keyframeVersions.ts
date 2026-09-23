import type { KeyframeMetadata } from "../schemas/project";

export function keepApprovedKeyframe(previous: KeyframeMetadata | undefined, nextStatus: string) {
  return Boolean(previous?.status === "ready" && previous.assetId && nextStatus !== "ready");
}

export function archiveSupersededKeyframe(
  versions: KeyframeMetadata[] | undefined,
  previous: KeyframeMetadata | undefined,
  nextAssetId: string | undefined,
  nextStatus: string
): KeyframeMetadata[] {
  const current = versions ?? [];
  if (!previous?.assetId || previous.status !== "ready" || nextStatus !== "ready" || previous.assetId === nextAssetId) return current;
  return [...current, previous].slice(-120);
}
