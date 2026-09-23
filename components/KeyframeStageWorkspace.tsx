"use client";

import React, { useEffect, useState } from "react";
import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import { VisualAssetPlaceholder } from "@/components/VisualAssetPlaceholder";
import type { GenerationProject } from "@/lib/schemas/project";

type Props = {
  project: GenerationProject;
  selectedShotId?: string;
  keyframes: Array<{ shotId: string; frameId?: string; localUrl?: string; imageUrl?: string; status?: string }>;
  busyShotId: string | null;
  error: string | null;
  onGenerate: (shotId: string, frameId?: string) => void;
  onConfirm: (shotId: string, frameId: string, locked: boolean) => void;
};

export function KeyframeStageWorkspace({ project, selectedShotId, keyframes, busyShotId, error, onGenerate, onConfirm }: Props) {
  const [frameIndex, setFrameIndex] = useState(0);
  const shot = project.shots.find((item) => item.id === selectedShotId) ?? project.shots[0];
  const frames = shot?.frames ?? [];
  const safeIndex = Math.min(frameIndex, Math.max(0, frames.length - 1));
  const frame = frames[safeIndex];
  const keyframe = keyframes.find((item) => item.frameId === frame?.id && item.shotId === shot?.id)
    ?? (frame ? undefined : keyframes.find((item) => item.shotId === shot?.id));
  const imageUrl = keyframe?.localUrl || keyframe?.imageUrl;
  const busy = busyShotId === shot?.id;
  useEffect(() => setFrameIndex(0), [selectedShotId]);
  if (!shot) return null;
  const status = frame?.isLocked ? "已确认" : busy || keyframe?.status === "loading" ? "生成中" : imageUrl && keyframe?.status === "ready" ? "待确认" : keyframe?.status === "failed" || keyframe?.status === "needs-review" ? "需要检查" : "待生成";
  const pendingCount = frames.filter((item) => !item.isLocked).length;
  const earlierVersions = (project.keyframeVersions ?? []).filter((item) => item.shotId === shot.id && item.frameId === frame?.id && (item.localUrl || item.imageUrl)).slice(-10).reverse();
  const generate = () => onGenerate(shot.id, imageUrl ? frame?.id : undefined);
  return <section className="keyframe-workspace" aria-label="关键帧制作">
    <header className="keyframe-workspace__header">
      <div><span>当前镜头</span><h2>镜头 {String(shot.index).padStart(2, "0")}</h2><p>{shot.durationSec} 秒 · {shot.cameraAngle || "镜头画面"} · {shot.sceneId || "场景"}</p></div>
      <button type="button" className="button-primary-v3" disabled={busy} onClick={generate}>{busy ? "生成中…" : imageUrl ? "重新生成" : "生成关键帧"}</button>
    </header>
    <div className="keyframe-workspace__preview">
      {imageUrl ? <AdaptiveMediaFrame aspectRatio={project.brief.aspectRatio} stage="keyframe" mediaType="image" src={imageUrl} fit="contain" showBlurredBackdrop={false} alt={`镜头 ${shot.index} 第 ${safeIndex + 1} 帧`} />
        : <VisualAssetPlaceholder title={busy ? "关键帧生成中" : "关键帧待生成"} description={busy ? "正在制作当前镜头画面。" : "当前镜头还没有关键帧。"} aspectRatio={project.brief.aspectRatio} status={busy ? "running" : keyframe?.status === "failed" ? "failed" : "pending"} actionLabel="生成关键帧" onAction={generate} />}
    </div>
    {frames.length > 1 ? <nav className="keyframe-workspace__pager" aria-label="当前镜头帧导航"><button type="button" aria-label="上一帧" onClick={() => setFrameIndex((safeIndex - 1 + frames.length) % frames.length)}>←</button><span>{safeIndex + 1} / {frames.length}</span><button type="button" aria-label="下一帧" onClick={() => setFrameIndex((safeIndex + 1) % frames.length)}>→</button></nav> : null}
    {frame && imageUrl && keyframe?.status === "ready" ? <div className="keyframe-workspace__confirm"><span>{frame.isLocked ? "当前帧已确认" : "检查画面后确认当前帧"}</span><button type="button" className="button-secondary-v3" disabled={busy} onClick={() => onConfirm(shot.id, frame.id, !frame.isLocked)}>{frame.isLocked ? "取消确认" : "确认当前帧"}</button></div> : null}
    {earlierVersions.length ? <details className="keyframe-workspace__creative"><summary>历史版本 · {earlierVersions.length}</summary><div className="keyframe-workspace__versions">{earlierVersions.map((item, index) => <a key={`${item.assetId}-${index}`} href={item.localUrl || item.imageUrl} target="_blank" rel="noreferrer">查看旧版本 {earlierVersions.length - index}</a>)}</div></details> : null}
    {error ? <p className="keyframe-workspace__error" role="alert">{error}</p> : null}
    <div className="keyframe-workspace__facts"><Info title="画面目标" body={shot.goal} /><Info title="人物状态" body={shot.microBeats?.[0]?.characterAction || "此镜头无人物动作"} /><Info title="产品状态" body={shot.microBeats?.[0]?.productAction || "遵循已确认产品图"} /><Info title="构图" body={frame?.description || shot.visualDescription} /><Info title="连续性" body={shot.continuityConstraints?.join("；") || "保持已确认视觉基准"} /></div>
    <details className="keyframe-workspace__creative"><summary>创意参考</summary><strong>{project.strategy.coreMessage}</strong><p>{project.strategy.bigIdea}</p></details>
    <details className="keyframe-workspace__creative"><summary>生成详情</summary><p>{shot.imagePromptCn || "生成记录和完整提示词可在项目精修中查看。"}</p></details>
    <span className="sr-only">当前镜头还有 {pendingCount} 帧待确认</span>
  </section>;
}

function Info({ title, body }: { title: string; body: string }) {
  return <article><h3>{title}</h3><p>{body}</p></article>;
}
