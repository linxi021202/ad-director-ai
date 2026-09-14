"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyframeResult } from "@/components/KeyframePreview";
import type { GenerationProject, StoryboardShot } from "@/lib/schemas/project";

export type ShotDetailsTab = "image" | "video" | "trace" | "cost" | "fallback";

type ShotDetailsSheetProps = {
  shot: StoryboardShot | null;
  keyframe?: KeyframeResult;
  project?: GenerationProject;
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
  project,
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
              {onRewritePrompt ? (
                <button type="button" className="shot-details-sheet__secondary" onClick={() => onRewritePrompt(shot)} disabled={isRewritingPrompt}>
                  {isRewritingPrompt ? "DeepSeek 优化中" : "调用 DeepSeek 优化提示词"}
                </button>
              ) : null}
            </>
          ) : null}
          {activeTab === "video" ? (
            <EditablePrompt title="中文视频提示词" value={shot.videoPromptCn} onChange={(value) => onUpdateShot(shot.id, { videoPromptCn: value })} />
          ) : null}
          {activeTab === "trace" ? <TraceList shot={shot} keyframe={keyframe} project={project} /> : null}
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
              <div><strong>{keyframe?.status === "needs-review" ? "视觉一致性检查未通过" : keyframe?.fallbackUsed ? "已启用降级方案" : "当前未触发降级"}</strong><p>{keyframe?.qaResult?.issues.join("；") || keyframe?.fallbackReason || shot.fallbackPlan}</p></div>
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

function TraceList({ shot, keyframe, project }: { shot: StoryboardShot; keyframe?: KeyframeResult; project?: GenerationProject }) {
  const qa = project?.keyframeQAResults?.filter((item) => item.shotId === shot.id).sort((a, b) => b.attempt - a.attempt)[0];
  const characterMasters = project?.characterVisualSpecs?.filter((item) => shot.characterIds?.includes(item.id));
  const sceneMaster = project?.sceneVisualSpecs?.find((item) => item.id === shot.sceneId);
  return (
    <dl className="shot-details-sheet__trace">
      <div><dt>推荐模型</dt><dd>{shot.recommendedModel}</dd></div>
      <div><dt>视频模式</dt><dd>{generationModeLabel(shot.generationMode)}</dd></div>
      <div><dt>连续性分组</dt><dd>{shot.continuityGroupId || "项目主线"}</dd></div>
      <div><dt>产品参考</dt><dd>{shot.containsProduct ? project?.productVisualSpec ? `产品原图已确认 · ${shot.exactProductShot ? "严格保持原产品" : "产品互动镜头"}` : "产品外观分析尚未完成，将继续使用产品原图" : "本镜头不含产品"}</dd></div>
      <div><dt>产品规格</dt><dd>{project?.productVisualSpec ? `${project.productVisualSpec.containerType} · ${project.productVisualSpec.shape} · ${project.productVisualSpec.capStructure}` : "尚未提取"}</dd></div>
      <div><dt>人物参考</dt><dd>{characterMasters?.length ? characterMasters.map((item) => `${item.id} ${item.locked ? "已锁定" : "待确认"}`).join("、") : "本镜头不需要人物参考"}</dd></div>
      <div><dt>场景参考</dt><dd>{sceneMaster ? `${sceneMaster.name} ${sceneMaster.locked ? "已锁定" : "待确认"}` : "使用项目场景规则"}</dd></div>
      <div><dt>QA 结果</dt><dd>{qa ? `${qa.overallPassed ? "通过" : "未通过"} · 第 ${qa.attempt} 次检查${qa.issues.length ? ` · ${qa.issues.join("；")}` : ""}` : "尚未检查"}</dd></div>
      <div><dt>场景状态</dt><dd>{shot.sceneStateBefore ? "已继承上一镜状态" : "首镜状态"}</dd></div>
      <div><dt>文字安全区</dt><dd>{textSafeZoneLabel(shot.textSafeZone)}</dd></div>
      <div><dt>服务商</dt><dd>{keyframe?.provider || "待调用"}</dd></div>
      <div><dt>请求编号</dt><dd>{keyframe?.requestId || "尚未生成"}</dd></div>
      <div><dt>本地缓存</dt><dd>{keyframe?.cacheStatus || "未请求"}</dd></div>
      <div><dt>降级状态</dt><dd>{keyframe?.fallbackUsed ? "已使用" : "未使用"}</dd></div>
    </dl>
  );
}

function generationModeLabel(mode: StoryboardShot["generationMode"]) {
  if (mode === "i2v" || mode === "i2v-first-frame") return "单首帧图生视频";
  if (mode === "r2v") return "历史项目兼容模式";
  if (mode === "continuation") return "连续动作";
  if (mode === "first-last-frame" || mode === "i2v-first-last") return "首尾帧过渡";
  if (mode === "remotion-motion") return "关键帧动效";
  return "参考生成";
}

function textSafeZoneLabel(zone: StoryboardShot["textSafeZone"]) {
  const labels = { "top-left": "左上", "top-center": "顶部居中", "bottom-left": "左下", none: "无文字层" } as const;
  return zone ? labels[zone] : "自动规划";
}
