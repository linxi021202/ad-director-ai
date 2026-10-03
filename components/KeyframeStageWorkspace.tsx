"use client";

import React, { useEffect, useState } from "react";
import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import { VisualAssetPlaceholder } from "@/components/VisualAssetPlaceholder";
import { CallLogDrawer } from "@/components/workspace/CallLogDrawer";
import type { GenerationProject } from "@/lib/schemas/project";
import { getShotKeyframeViewState } from "@/lib/image/keyframeViewState";

type Props = {
  project: GenerationProject;
  selectedShotId?: string;
  initialFrameId?: string;
  busyShotId: string | null;
  error: string | null;
  onGenerate: (shotId: string, frameId?: string) => void;
  onConfirm: (shotId: string, frameId: string, locked: boolean) => void;
};

export function KeyframeStageWorkspace({ project, selectedShotId, initialFrameId, busyShotId, error, onGenerate, onConfirm }: Props) {
  const [frameIndex, setFrameIndex] = useState(() => initialFrameId
    ? project.shots.find((item) => item.id === selectedShotId)?.frames?.findIndex((frame) => frame.id === initialFrameId) ?? -1 : -1);
  const [brokenUrl, setBrokenUrl] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const shot = project.shots.find((item) => item.id === selectedShotId) ?? project.shots[0];
  const frames = shot?.frames ?? [];
  const view = getShotKeyframeViewState(project, shot?.id ?? "", busyShotId === shot?.id);
  const firstAvailable = view.frameViews.findIndex((item) => item.imageUrl);
  const safeIndex = Math.min(frameIndex < 0 ? Math.max(0, firstAvailable) : frameIndex, Math.max(0, frames.length - 1));
  const frame = frames[safeIndex];
  const moment = frame?.keyframeMoment;
  const keyframe = view.frameViews[safeIndex]?.image;
  const savedUrl = view.frameViews[safeIndex]?.imageUrl;
  const imageUrl = savedUrl === brokenUrl ? undefined : savedUrl;
  const shotJob = project.generationEvents?.findLast((item) => item.stage === "keyframes" && item.shotId === shot?.id
    && item.action === "制作单镜关键帧" && ["queued", "running", "qa-review"].includes(item.status));
  const busy = busyShotId === shot?.id || Boolean(shotJob) || view.keyframeGenerationStatus === "generating";
  const activeEvent = project.generationEvents?.findLast((item) => item.stage === "keyframes" && item.shotId === shot?.id
    && item.frameId === frame?.id && ["queued", "running", "qa-review"].includes(item.status)) ?? shotJob;
  const elapsed = activeEvent ? Math.floor((now - activeEvent.startedAt) / 1000) : 0;
  const waitingText = activeEvent ? `模型正在生成，已等待 ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒。` : "正在制作当前镜头画面。";
  const responseTimeout = view.frameViews[safeIndex]?.responseTimeout;
  useEffect(() => {
    setFrameIndex(initialFrameId ? frames.findIndex((item) => item.id === initialFrameId) : -1);
    setBrokenUrl(undefined);
  }, [selectedShotId, initialFrameId]);
  useEffect(() => {
    if (!activeEvent) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeEvent?.id]);
  if (!shot) return null;
  const preparing = busy && view.promptStatus !== "ready";
  const status = savedUrl === brokenUrl && savedUrl ? "需要检查" : frame?.isLocked && imageUrl ? "已确认" : busy || keyframe?.status === "loading" ? "生成中" : responseTimeout ? "响应超时" : imageUrl ? "已生成待确认" : keyframe?.status === "failed" || keyframe?.status === "needs-review" ? "需要检查" : "待生成";
  const pendingCount = frames.filter((item) => !item.isLocked).length;
  const earlierVersions = (project.keyframeVersions ?? []).filter((item) => item.shotId === shot.id && item.frameId === frame?.id && (item.localUrl || item.imageUrl)).slice(-10).reverse();
  const generate = () => onGenerate(shot.id);
  const regenerateFrame = () => { if (frame) onGenerate(shot.id, frame.id); };
  const allGenerated = view.totalCount > 0 && view.completedCount === view.totalCount;
  const failedCount = view.failedFrameIds.length;
  return <section className="keyframe-workspace" aria-label="关键帧制作">
    <header className="keyframe-workspace__header">
      <div><span>当前镜头</span><h2>镜头 {String(shot.index).padStart(2, "0")}</h2><p>{shot.durationSec} 秒 · {shot.cameraAngle || "镜头画面"} · {shot.sceneId || "场景"}</p></div>
      <div className="keyframe-workspace__header-actions"><CallLogDrawer projectId={project.id} projectName={project.brief.productName} label="查看镜头日志" focusStage="keyframes" focusShotId={shot.id} /><button type="button" className="button-primary-v3" disabled={busy} onClick={generate}>{busy ? preparing ? "准备中…" : `生成中 ${view.completedCount}/${view.totalCount}` : allGenerated ? "重新生成当前镜头" : failedCount ? "重试失败关键帧" : "生成关键帧"}</button></div>
    </header>
    {frame ? <div className="keyframe-workspace__moment"><strong>关键帧 {safeIndex + 1} · {(moment?.timestampSec ?? frame.timestampSec).toFixed(1)} 秒</strong><span>{moment?.narrativePurpose ?? frame.description}</span>{safeIndex > 0 && moment ? <small>与上一帧变化：{moment.continuityFromPreviousFrame}</small> : null}</div> : null}
    <div className="keyframe-workspace__preview">
      {imageUrl ? <AdaptiveMediaFrame aspectRatio={project.brief.aspectRatio} stage="keyframe" mediaType="image" src={imageUrl} fit="contain" showBlurredBackdrop={false} onError={() => setBrokenUrl(imageUrl)} status={<span>{status}</span>} alt={`镜头 ${shot.index} 第 ${safeIndex + 1} 帧`} />
        : <VisualAssetPlaceholder title={preparing ? "正在准备镜头生成参数…" : busy ? "关键帧生成中" : responseTimeout ? "图像模型响应超时" : status === "需要检查" || view.status === "failed" ? "当前关键帧生成失败" : "关键帧待生成"} description={busy ? waitingText : responseTimeout ? "已完成的图片会保留，请查看镜头日志后重试当前帧。" : view.hasAnyKeyframe ? "当前帧尚未生成，其它已生成帧已保留。" : "当前镜头还没有关键帧。"} aspectRatio={project.brief.aspectRatio} status={busy ? "running" : responseTimeout || status === "需要检查" || view.status === "failed" ? "failed" : "pending"} actionLabel={responseTimeout ? "重新生成当前帧" : "生成关键帧"} onAction={responseTimeout ? regenerateFrame : generate} />}
    </div>
    {frames.length > 1 ? <nav className="keyframe-workspace__pager" aria-label="当前镜头帧导航"><button type="button" aria-label="上一帧" onClick={() => setFrameIndex((safeIndex - 1 + frames.length) % frames.length)}>←</button><span>{safeIndex + 1} / {frames.length}</span><button type="button" aria-label="下一帧" onClick={() => setFrameIndex((safeIndex + 1) % frames.length)}>→</button></nav> : null}
    {imageUrl && !busy ? <div className="keyframe-workspace__frame-action"><button type="button" className="button-secondary-v3" onClick={regenerateFrame}>重新生成当前帧</button></div> : null}
    {frame && imageUrl && keyframe?.status === "ready" ? <div className="keyframe-workspace__confirm"><span>{frame.isLocked ? "当前帧已确认" : "检查画面后确认当前帧"}</span><button type="button" className="button-secondary-v3" disabled={busy} onClick={() => onConfirm(shot.id, frame.id, !frame.isLocked)}>{frame.isLocked ? "取消确认" : "确认当前帧"}</button></div> : null}
    {earlierVersions.length ? <details className="keyframe-workspace__creative"><summary>历史版本 · {earlierVersions.length}</summary><div className="keyframe-workspace__versions">{earlierVersions.map((item, index) => <a key={`${item.assetId}-${index}`} href={item.localUrl || item.imageUrl} target="_blank" rel="noreferrer">查看旧版本 {earlierVersions.length - index}</a>)}</div></details> : null}
    {error ? <p className="keyframe-workspace__error" role="alert">{error}</p> : null}
    <div className="keyframe-workspace__facts"><Info title="画面目标" body={shot.goal} /><Info title="人物状态" body={moment ? `${moment.characterPose}；${moment.handState}；${moment.gazeDirection}` : shot.microBeats?.[0]?.characterAction || "此镜头无人物动作"} /><Info title="产品状态" body={moment ? `${moment.productPosition}；${moment.productOrientation}` : shot.microBeats?.[0]?.productAction || "遵循已确认产品图"} /><Info title="构图" body={moment?.momentDescription || frame?.description || shot.visualDescription} /><Info title="连续性" body={shot.continuityConstraints?.join("；") || "保持已确认视觉基准"} /></div>
    <details className="keyframe-workspace__creative"><summary>创意参考</summary><strong>{project.strategy.coreMessage}</strong><p>{project.strategy.bigIdea}</p></details>
    <span className="sr-only">当前镜头还有 {pendingCount} 帧待确认</span>
  </section>;
}

function Info({ title, body }: { title: string; body: string }) {
  return <article><h3>{title}</h3><p>{body}</p></article>;
}
