import "server-only";

import { assertPrivateAssetReadable, getPrivateAsset } from "../assets/assetStore";
import { readModelCallLogArchive } from "../logs/modelCallStore";
import { mutateOwnedAnonymousProject, requireOwnedAnonymousProject } from "../projects/anonymousProjectStore";
import type { KeyframeMetadata } from "../schemas/project";

export async function recoverGeneratedKeyframeAssets(sessionId: string, projectId: string) {
  const record = await requireOwnedAnonymousProject(sessionId, projectId);
  const archive = await readModelCallLogArchive(sessionId, projectId);
  const candidates: Array<{ shotId: string; frameId: string; assetId: string; model?: string }> = [];
  for (const shot of record.project.shots) {
    for (const frame of shot.frames ?? []) {
      const metadata = record.project.keyframes?.find((item) => item.shotId === shot.id && item.frameId === frame.id);
      if (frame.isLocked || metadata?.assetId && frame.assetId === metadata.assetId
        || frame.assetId && metadata?.assetId && frame.assetId !== metadata.assetId) continue;
      const call = [...archive.entries].reverse().find((entry) => entry.kind === "call" && entry.stage === "keyframes"
        && entry.provider === "qwen-image" && entry.shotId === shot.id && entry.frameId === frame.id
        && entry.status === "completed" && entry.outputAssetIds?.length
        && record.project.generationEvents?.some((event) => event.id === entry.taskId && event.stage === "keyframes"
          && event.shotId === shot.id && event.frameId === frame.id));
      const assetId = frame.assetId ?? metadata?.assetId ?? call?.outputAssetIds?.[0];
      if (!assetId) continue;
      const asset = await getPrivateAsset(sessionId, projectId, assetId);
      if (!asset || asset.kind !== "keyframe" || asset.source !== "qwen-image") continue;
      try { await assertPrivateAssetReadable(asset); } catch { continue; }
      candidates.push({ shotId: shot.id, frameId: frame.id, assetId, model: call?.model });
    }
  }
  if (!candidates.length) return { recovered: [] as typeof candidates };
  const recovered: typeof candidates = [];
  await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => {
    let shots = latest.shots;
    let keyframes = latest.keyframes ?? [];
    for (const candidate of candidates) {
      const shot = shots.find((item) => item.id === candidate.shotId);
      const frame = shot?.frames?.find((item) => item.id === candidate.frameId);
      const existing = keyframes.find((item) => item.shotId === candidate.shotId && item.frameId === candidate.frameId);
      if (!frame || frame.isLocked || frame.assetId && frame.assetId !== candidate.assetId
        || existing?.assetId && existing.assetId !== candidate.assetId
        || frame.assetId === candidate.assetId && existing?.assetId === candidate.assetId) continue;
      const metadata: KeyframeMetadata = { shotId: candidate.shotId, frameId: candidate.frameId, assetId: candidate.assetId,
        localUrl: `/api/projects/${projectId}/assets/${candidate.assetId}`, provider: "qwenImageProvider", model: candidate.model,
        fallbackUsed: false, status: "ready", storageTransition: "PRIVATE_ASSET_V1" };
      keyframes = [...keyframes.filter((item) => item.shotId !== candidate.shotId || item.frameId !== candidate.frameId), existing?.assetId ? existing : metadata];
      shots = shots.map((item) => item.id !== candidate.shotId ? item : { ...item,
        primaryKeyframeAssetId: item.primaryKeyframeAssetId ?? candidate.assetId,
        frames: item.frames?.map((part) => part.id !== candidate.frameId ? part : { ...part, assetId: candidate.assetId, status: "ready" as const }) });
      recovered.push(candidate);
    }
    return { ...latest, shots, keyframes };
  });
  return { recovered };
}
