"use client";

import type { ReactNode } from "react";
import type { GenerationProject, StageId, StageState, StageStates } from "@/lib/schemas/project";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_RESOURCE,
  calculateDependencyImpact,
  canRunStage,
  currentResourceVersion
} from "@/lib/workflow/stageGates";
import { getProjectDurationSec } from "@/lib/video/shotConfig";
import { getVisualAnchorReadiness } from "@/lib/visual/visualAnchors";

export function StageDirectorRail({
  activeStage,
  states,
  onSelect
}: {
  activeStage: StageId;
  states: StageStates;
  onSelect: (stageId: StageId) => void;
}) {
  return (
    <nav className="stage-director-rail" aria-label="广告制作阶段">
      <ol>
        {STAGE_ORDER.map((stageId, index) => {
          const state = states[stageId];
          return (
            <li key={stageId} className={`is-${state.status}${activeStage === stageId ? " is-active" : ""}`}>
              <button type="button" aria-current={activeStage === stageId ? "step" : undefined} onClick={() => onSelect(stageId)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{STAGE_LABELS[stageId]}</strong>
                <small>{stageStatusLabel(state.status)}</small>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StageContextPanel({ project, activeStage, open, onClose }: { project: GenerationProject; activeStage: StageId; open?: boolean; onClose?: () => void }) {
  const shots = project.shots;
  return (
    <aside className={`stage-context-panel${open ? " is-open" : ""}`} aria-label="阶段导航">
      <header><div><span>Context</span><h2>{contextTitle(activeStage)}</h2></div>{onClose ? <button type="button" className="stage-sheet-close" aria-label="关闭阶段导航" onClick={onClose}>×</button> : null}</header>
      {activeStage === "brief" ? (
        <dl className="stage-context-summary">
          <ContextMetric label="项目" value={project.brief.productName || "未命名商品"} />
          <ContextMetric label="平台" value={platformLabel(project.brief.platform)} />
          <ContextMetric label="画幅" value={project.brief.aspectRatio} />
          <ContextMetric label="镜头" value={`${shots.length} 个`} />
          <ContextMetric label="目标 / 实际" value={`${project.targetDurationSec ?? project.brief.durationSec}s / ${getProjectDurationSec(project)}s`} />
        </dl>
      ) : null}
      {activeStage === "creative" ? (
        <div className="stage-context-list"><span className="is-current">当前方向</span><button type="button">候选方向 01</button><button type="button" disabled>候选方向 02</button><button type="button" disabled>候选方向 03</button></div>
      ) : null}
      {activeStage === "anchors" ? (
        <div className="stage-context-list"><span>身份基准</span><a href="#anchor-product">产品基准</a>{(project.characterVisualSpecs ?? []).map((spec) => <a key={spec.id} href={`#anchor-character-${spec.id}`}>{spec.role}<small>{spec.locked ? "Locked" : "待确认"}</small></a>)}{(project.sceneVisualSpecs ?? []).map((spec) => <a key={spec.id} href={`#anchor-scene-${spec.id}`}>{spec.name}<small>{spec.locked ? "Locked" : "待确认"}</small></a>)}</div>
      ) : null}
      {activeStage === "storyboard" || activeStage === "keyframes" || activeStage === "video" ? (
        <div className="stage-shot-navigator"><span>{activeStage === "video" ? "镜头生成" : "Shot Navigator"}</span>{shots.map((shot) => <a key={shot.id} href={`#${activeStage}-shot-${shot.id}`}>Shot {String(shot.index).padStart(2, "0")}<small>{shot.durationSec}s</small></a>)}</div>
      ) : null}
      {activeStage === "final" ? (
        <div className="stage-context-list"><span>Final Sections</span><button type="button">准备度</button><button type="button">Ending</button><button type="button">商业质检</button></div>
      ) : null}
      <footer><small>实际时间轴</small><strong>{getProjectDurationSec(project)} 秒</strong></footer>
    </aside>
  );
}

export function StageInspector({
  project,
  activeStage,
  state,
  busy,
  onLock,
  onOpenModels,
  open,
  onClose,
  children
}: {
  project: GenerationProject;
  activeStage: StageId;
  state: StageState;
  busy: boolean;
  onLock: () => void;
  onOpenModels: () => void;
  open?: boolean;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const states = project.stageStates!;
  const gate = canRunStage(states, activeStage);
  const resource = STAGE_RESOURCE[activeStage];
  const version = currentResourceVersion(project.resourceVersions ?? [], resource.resourceId);
  const impact = version
    ? calculateDependencyImpact(project.dependencyGraph ?? [], resource.resourceId, version.version, version.version + 1)
    : null;
  const dependencies = (project.dependencyGraph ?? []).find((node) => node.resourceId === resource.resourceId)?.dependsOn ?? [];
  const anchorReadiness = activeStage === "anchors" ? getVisualAnchorReadiness(project) : null;
  return (
    <aside className={`stage-inspector${open ? " is-open" : ""}`} aria-label="阶段检查器">
      <header><div><span>Stage Inspector</span><h2>{STAGE_LABELS[activeStage]}</h2></div>{onClose ? <button type="button" className="stage-sheet-close" aria-label="关闭阶段检查器" onClick={onClose}>×</button> : null}</header>
      <section className="stage-inspector-status">
        <div><span>状态</span><strong className={`is-${state.status}`}>{stageStatusLabel(state.status)}</strong></div>
        <div><span>当前版本</span><strong>{version ? `V${version.version}` : "尚未创建"}</strong></div>
        <div><span>锁定</span><strong>{state.status === "locked" ? "用户已确认" : "等待确认"}</strong></div>
      </section>
      <section className="stage-inspector-section">
        <h3>依赖</h3>
        {dependencies.length ? dependencies.map((item) => <p key={`${item.resourceId}-${item.version}`}>{resourceLabel(item.resourceId)} <span>V{item.version}</span></p>) : <p>无上游依赖</p>}
        {!gate.allowed ? <div className="stage-gate-blocked">{gate.reason}</div> : null}
      </section>
      <section className="stage-inspector-section">
        <h3>修改影响</h3>
        {impact && impact.affectedStages.length ? <p>{impact.affectedStages.map((item) => STAGE_LABELS[item]).join("、")}</p> : <p>当前没有已生成的下游资产。</p>}
        {impact?.affectedShotIds.length ? <small>{impact.affectedShotIds.length} 个镜头 · {impact.affectedFrameIds.length} 帧 · {impact.affectedVideoIds.length} 个视频</small> : null}
      </section>
      {anchorReadiness ? <section className="stage-inspector-section stage-anchor-readiness"><h3>Anchor Gate</h3><p><span>产品</span><strong>{anchorReadiness.productLocked ? "Locked" : "待确认"}</strong></p><p><span>人物</span><strong>{anchorReadiness.missingCharacterIds.length ? `缺 ${anchorReadiness.missingCharacterIds.length}` : "Locked"}</strong></p><p><span>场景</span><strong>{anchorReadiness.missingSceneIds.length ? `缺 ${anchorReadiness.missingSceneIds.length}` : "Locked"}</strong></p>{!anchorReadiness.ready ? <small>全部 Required Masters 锁定后，才可锁定视觉基准。</small> : null}</section> : null}
      {state.status === "ready" ? <button type="button" className="stage-lock-button" disabled={busy || !gate.allowed} onClick={onLock}>{busy ? "锁定中" : `锁定${STAGE_LABELS[activeStage]}`}</button> : null}
      {state.status === "locked" ? <div className="stage-locked-note">Locked 内容不会被 AI 静默覆盖。</div> : null}
      <details className="stage-provider-details"><summary>Provider Readiness</summary><button type="button" onClick={onOpenModels}>管理模型配置</button></details>
      <details className="stage-provider-details"><summary>Generation Trace</summary><p>完整服务端事件保留在项目日志中。</p></details>
      {children}
    </aside>
  );
}

export function stageStatusLabel(status: StageState["status"]): string {
  return ({
    draft: "编辑中",
    running: "执行中",
    ready: "待确认",
    locked: "已锁定",
    outdated: "需更新",
    failed: "失败",
    blocked: "待解锁"
  } as const)[status];
}

function ContextMetric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function contextTitle(stageId: StageId): string {
  if (stageId === "brief") return "项目摘要";
  if (stageId === "creative") return "创意候选";
  if (stageId === "anchors") return "视觉身份";
  if (stageId === "final") return "成片检查";
  return "镜头导航";
}

function platformLabel(platform: GenerationProject["brief"]["platform"]): string {
  return ({ douyin: "抖音", xiaohongshu: "小红书", ecommerce: "电商" } as const)[platform];
}

function resourceLabel(resourceId: string): string {
  const stage = (Object.entries(STAGE_RESOURCE) as Array<[StageId, { resourceId: string }]>)
    .find(([, resource]) => resource.resourceId === resourceId)?.[0];
  return stage ? STAGE_LABELS[stage] : resourceId;
}
