import type { GenerationProject, KeyframeMetadata } from "../schemas/project";
import { derivePromptStageShotState } from "../workflow/shotPromptProgress";
import type { KeyframeResult } from "@/components/KeyframePreview";

export type KeyframeProjectSnapshot = GenerationProject;

export function projectKeyframesToImages(project: KeyframeProjectSnapshot): Array<KeyframeResult & { provider: string; model: string; latencyMs: number; cacheStatus: string; fallbackUsed: boolean }> {
  return (project.keyframes ?? []).map((item) => ({ ...item,
    provider: item.provider ?? "planned", model: item.model ?? "qwen-image", latencyMs: item.latencyMs ?? 0,
    cacheStatus: item.cacheStatus ?? "not-requested", fallbackUsed: item.fallbackUsed,
    localUrl: item.localUrl || (item.assetId ? `/api/projects/${project.id}/assets/${item.assetId}` : undefined),
    status: item.status === "response_timeout" ? "response_timeout" : item.status === "ready" ? "ready" : item.status === "generated" ? "generated"
      : ["text-qa", "product-qa", "character-qa", "scene-qa", "qa-review"].includes(item.status) ? "qa-review"
        : item.status === "needs-review" ? "needs-review" : item.status === "pending" ? "loading" : "failed",
    qaResult: project.keyframeQAResults?.filter((qa) => qa.shotId === item.shotId && qa.frameId === item.frameId)
      .sort((a, b) => b.attempt - a.attempt)[0] ?? null
  }));
}

export function getShotKeyframeViewState(project: KeyframeProjectSnapshot, shotId: string, busy = false) {
  const shot = project.shots.find((item) => item.id === shotId);
  const latest = (stage: "prompts" | "keyframes") => project.generationEvents?.filter((event) => event.stage === stage && event.shotId === shotId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const imageEvent = latest("keyframes");
  const active = (status?: string) => ["queued", "running", "qa-review"].includes(status ?? "");
  const failed = (status?: string) => ["failed", "interrupted"].includes(status ?? "");
  const promptState = derivePromptStageShotState(project, shotId);
  const promptStatus = promptState.status;
  const records = projectKeyframesToImages(project).filter((item) => item.shotId === shotId);
  const frameViews = (shot?.frames?.length ? shot.frames : [undefined]).map((frame, index) => {
    const saved = project.keyframes?.findLast((item) => item.shotId === shotId && (item.frameId === frame?.id || !item.frameId && index === 0));
    const metadata: KeyframeMetadata | undefined = saved?.assetId || !frame?.assetId ? saved : {
      shotId, frameId: frame.id, assetId: frame.assetId, status: frame.status === "ready" ? "ready" : "generated",
      fallbackUsed: false, storageTransition: "PRIVATE_ASSET_V1"
    };
    const image = metadata?.assetId ? records.findLast((item) => item.frameId === metadata.frameId && item.assetId === metadata.assetId)
      ?? { ...metadata, provider: metadata.provider ?? "planned", model: metadata.model ?? "qwen-image", latencyMs: metadata.latencyMs ?? 0,
        cacheStatus: metadata.cacheStatus ?? "not-requested", localUrl: `/api/projects/${project.id}/assets/${metadata.assetId}`,
        status: metadata.status === "ready" ? "ready" as const : "generated" as const }
      : metadata ? records.findLast((item) => item.frameId === metadata.frameId) : undefined;
    const imageUrl = metadata && !metadata.fallbackUsed && !["failed", "fallback", "pending", "response_timeout"].includes(metadata.status)
      ? metadata.assetId ? `/api/projects/${project.id}/assets/${metadata.assetId}` : image?.localUrl || image?.imageUrl : undefined;
    const assetStatus = imageUrl ? metadata?.assetId ? "persisted" : "generated" : metadata && metadata.status !== "pending" ? "broken" : "none";
    const confirmationStatus = imageUrl && frame?.isLocked ? "confirmed" : "unconfirmed";
    const frameEvent = project.generationEvents?.filter((event) => event.stage === "keyframes" && event.shotId === shotId && event.frameId === frame?.id)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    const framePromptStatus = promptStatus === "ready" ? "ready" : promptState.completedFrameIds.includes(frame?.id ?? "") ? "partial"
      : promptState.failedFrameIds.includes(frame?.id ?? "") ? "failed" : promptStatus;
    const keyframeGenerationStatus = active(frameEvent?.status) || image && ["loading", "generated", "qa-review"].includes(image.status) ? "generating"
      : imageUrl && metadata?.status === "ready" ? "completed" : imageUrl ? "partial" : assetStatus === "broken" || failed(frameEvent?.status) ? "failed" : "not_started";
    return { frame, metadata, image, imageUrl, assetStatus, confirmationStatus, promptStatus: framePromptStatus, keyframeGenerationStatus,
      responseTimeout: metadata?.status === "response_timeout" || frameEvent?.errorCode === "PROVIDER_RESPONSE_TIMEOUT" };
  });
  const completedCount = frameViews.filter((item) => item.imageUrl && item.metadata?.status === "ready").length;
  const hasAnyKeyframe = frameViews.some((item) => item.imageUrl);
  const hasFailed = frameViews.some((item) => item.assetStatus === "broken" || item.metadata?.status === "needs-review") || failed(imageEvent?.status);
  const generating = active(imageEvent?.status) || busy && promptStatus === "ready" || frameViews.some((item) => item.image && ["loading", "generated", "qa-review"].includes(item.image.status));
  const keyframeGenerationStatus = generating ? "generating" : completedCount === frameViews.length ? "completed"
    : hasAnyKeyframe ? "partial" : hasFailed ? "failed" : "not_started";
  const confirmationStatus = hasAnyKeyframe && frameViews.every((item) => item.confirmationStatus === "confirmed") ? "confirmed" : "unconfirmed";
  const label = confirmationStatus === "confirmed" ? "已确认" : generating ? "生成中" : keyframeGenerationStatus === "completed" ? "已生成待确认"
    : hasAnyKeyframe ? `部分已生成 ${completedCount}/${frameViews.length}` : hasFailed ? "生成失败"
      : promptStatus === "failed" || promptStatus === "partial" ? "提示词待完成" : "待生成";
  const status = confirmationStatus === "confirmed" ? "confirmed" : generating ? "generating" : keyframeGenerationStatus === "completed" ? "generated"
    : hasAnyKeyframe ? "partial" : hasFailed ? "failed" : "not_started";
  return { promptStatus, keyframeGenerationStatus, confirmationStatus, status, hasAnyKeyframe, completedCount, totalCount: frameViews.length,
    hasFailed, awaitingConfirmation: hasAnyKeyframe && confirmationStatus !== "confirmed", frameViews,
    primaryImage: frameViews.find((item) => item.imageUrl)?.image, label };
}

export function getMissingKeyframeIds(project: KeyframeProjectSnapshot, shotId: string) {
  return getShotKeyframeViewState(project, shotId).frameViews.filter((item) => !item.imageUrl || item.metadata?.status !== "ready")
    .flatMap((item) => item.frame ? [item.frame.id] : []);
}

export function getProjectKeyframeViewState(project: KeyframeProjectSnapshot) {
  const shots = project.shots.map((shot) => getShotKeyframeViewState(project, shot.id));
  const totalCount = shots.reduce((sum, shot) => sum + shot.totalCount, 0);
  const completedCount = shots.reduce((sum, shot) => sum + shot.completedCount, 0);
  const hasAnyKeyframe = shots.some((shot) => shot.hasAnyKeyframe);
  const hasFailed = shots.some((shot) => shot.hasFailed);
  const keyframeGenerationStatus = shots.some((shot) => shot.keyframeGenerationStatus === "generating") ? "generating"
    : totalCount > 0 && completedCount === totalCount ? "completed" : hasAnyKeyframe ? "partial" : hasFailed ? "failed" : "not_started";
  return { shots, totalCount, completedCount, hasAnyKeyframe, hasFailed, keyframeGenerationStatus,
    completedShotCount: shots.filter((shot) => shot.completedCount === shot.totalCount).length };
}
