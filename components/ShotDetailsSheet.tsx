"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyframeResult } from "@/components/KeyframePreview";
import type { StoryboardShot } from "@/lib/schemas/project";

export type ShotDetailsTab = "image" | "video" | "trace" | "cost" | "fallback";

type ShotDetailsSheetProps = {
  shot: StoryboardShot | null;
  keyframe?: KeyframeResult;
  initialTab?: ShotDetailsTab;
  onClose: () => void;
  onUpdateShot: (shotId: string, patch: Partial<StoryboardShot>) => void;
  onRewritePrompt?: (shot: StoryboardShot) => void;
  isRewritingPrompt?: boolean;
};

const tabs: Array<{ id: ShotDetailsTab; label: string }> = [
  { id: "image", label: "图片提示词" },
  { id: "video", label: "视频提示词" },
  { id: "trace", label: "模型调用" },
  { id: "cost", label: "耗时与资源" },
  { id: "fallback", label: "错误与降级" }
];

export function ShotDetailsSheet({
  shot,
  keyframe,
  initialTab = "image",
  onClose,
  onUpdateShot,
  onRewritePrompt,
  isRewritingPrompt = false
}: ShotDetailsSheetProps) {
  const [activeTab, setActiveTab] = useState<ShotDetailsTab>(initialTab);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!shot) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActiveTab(initialTab);
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [shot?.id, initialTab]);

  if (!shot || typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="shot-details-sheet"
      aria-label={`镜头 ${shot.index} 生成详情`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="shot-details-sheet__panel">
        <header>
          <div><span>镜头 {shot.index}</span><h2>生成详情</h2></div>
          <button type="button" aria-label="关闭生成详情" onClick={onClose}>关闭</button>
        </header>

        <div className="shot-details-sheet__tabs" role="tablist" aria-label="生成详情分类">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "is-active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <section className="shot-details-sheet__body" role="tabpanel">
          {activeTab === "image" ? (
            <>
              <EditablePrompt title="中文图片提示词" value={shot.imagePromptCn} onChange={(value) => onUpdateShot(shot.id, { imagePromptCn: value })} />
              <EditablePrompt title="英文图片提示词" value={shot.imagePromptEn} onChange={(value) => onUpdateShot(shot.id, { imagePromptEn: value })} />
              <button type="button" className="shot-details-sheet__secondary" onClick={() => onRewritePrompt?.(shot)} disabled={!onRewritePrompt || isRewritingPrompt}>
                {isRewritingPrompt ? "DeepSeek 优化中" : "调用 DeepSeek 优化提示词"}
              </button>
            </>
          ) : null}
          {activeTab === "video" ? (
            <EditablePrompt title="中文视频提示词" value={shot.videoPromptCn} onChange={(value) => onUpdateShot(shot.id, { videoPromptCn: value })} />
          ) : null}
          {activeTab === "trace" ? <TraceList shot={shot} keyframe={keyframe} /> : null}
          {activeTab === "cost" ? (
            <div className="shot-details-sheet__metrics">
              <article><span>服务商</span><strong>{keyframe?.provider || "待调用"}</strong></article>
              <article><span>模型</span><strong>{keyframe?.model || shot.recommendedModel}</strong></article>
              <article><span>延迟</span><strong>{typeof keyframe?.latencyMs === "number" ? `${keyframe.latencyMs} 毫秒` : "待生成"}</strong></article>
              <article><span>缓存</span><strong>{keyframe?.cacheStatus || "未请求"}</strong></article>
            </div>
          ) : null}
          {activeTab === "fallback" ? (
            <div className="shot-details-sheet__message">
              <span className={keyframe?.fallbackUsed ? "is-warning" : "is-success"} />
              <div><strong>{keyframe?.fallbackUsed ? "已启用降级方案" : "当前未触发降级"}</strong><p>{keyframe?.fallbackReason || shot.fallbackPlan}</p></div>
            </div>
          ) : null}
        </section>

        <footer><button type="button" onClick={onClose}>关闭详情</button></footer>
      </div>
    </dialog>,
    document.body
  );
}

function EditablePrompt({ title, value, onChange }: { title: string; value: string; onChange: (value: string) => void }) {
  return <label className="shot-details-sheet__prompt"><span>{title}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={8} /></label>;
}

function TraceList({ shot, keyframe }: { shot: StoryboardShot; keyframe?: KeyframeResult }) {
  return (
    <dl className="shot-details-sheet__trace">
      <div><dt>推荐模型</dt><dd>{shot.recommendedModel}</dd></div>
      <div><dt>服务商</dt><dd>{keyframe?.provider || "待调用"}</dd></div>
      <div><dt>请求编号</dt><dd>{keyframe?.requestId || "尚未生成"}</dd></div>
      <div><dt>本地缓存</dt><dd>{keyframe?.cacheStatus || "未请求"}</dd></div>
      <div><dt>降级状态</dt><dd>{keyframe?.fallbackUsed ? "已使用" : "未使用"}</dd></div>
    </dl>
  );
}
