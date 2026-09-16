"use client";

import type { ReactNode } from "react";
import type { GenerationProject, StageId, StageState, StageStates } from "@/lib/schemas/project";
import { STAGE_LABELS, calculateDependencyImpact, canRunStage, currentResourceVersion, STAGE_RESOURCE } from "@/lib/workflow/stageGates";
import { resolveProjectPlanningConstraints } from "@/lib/projects/planningConstraints";
import { getActionBlockers, type WorkflowAction } from "@/lib/workflow/actionBlockers";
import { GuardedActionButton } from "@/components/workflow/GuardedActionButton";
import { deriveVisualSetupStageState, visualSetupStatusLabel } from "@/lib/visual/visualSetupStage";

const MAJOR_STEPS: Array<{ label: string; stages: StageId[] }> = [
  { label: "商品与创意", stages: ["brief", "creative"] },
  { label: "人物与场景", stages: ["anchors"] },
  { label: "分镜制作", stages: ["storyboard", "keyframes"] },
  { label: "视频与成片", stages: ["video", "final"] }
];

export function StageDirectorRail({ project, activeStage, states, onSelect }: { project: GenerationProject; activeStage: StageId; states: StageStates; onSelect: (stageId: StageId) => void }) {
  const visualSetup = deriveVisualSetupStageState({ ...project, stageStates: states });
  return <nav className="stage-director-rail" aria-label="广告制作进度"><ol>{MAJOR_STEPS.map((step, index) => {
    const active = step.stages.includes(activeStage);
    const isVisualSetup = step.stages.length === 1 && step.stages[0] === "anchors";
    const status = isVisualSetup ? visualSetupStatusToStageStatus(visualSetup.status) : majorStatus(step.stages.map((stage) => states[stage]));
    const label = isVisualSetup ? visualSetupStatusLabel(visualSetup.status) : stageStatusLabel(status);
    return <li key={step.label} className={`is-${status}${active ? " is-active" : ""}`}><button type="button" aria-current={active ? "step" : undefined} onClick={() => onSelect(resolveMajorTarget(step.stages, states, activeStage))}><span>{isVisualSetup && visualSetup.status === "completed" ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{step.label}</strong><small>{label}</small></button></li>;
  })}</ol></nav>;
}

export function StageContextPanel({ project, activeStage, onSelect, open, onClose }: { project: GenerationProject; activeStage: StageId; onSelect?: (stageId: StageId) => void; open?: boolean; onClose?: () => void }) {
  const constraints = resolveProjectPlanningConstraints(project);
  const step = MAJOR_STEPS.find((item) => item.stages.includes(activeStage))!;
  const visualSetup = activeStage === "anchors" ? deriveVisualSetupStageState(project) : null;
  return <aside className={`stage-context-panel workspace-column workspace-column--left${open ? " is-open" : ""}`} aria-label="项目导航">
    <header><div><span>当前步骤</span><h2>{step.label}</h2></div>{onClose ? <button type="button" className="stage-sheet-close" aria-label="关闭项目导航" onClick={onClose}>×</button> : null}</header>
    {activeStage === "brief" ? <p className="stage-context-copy">先完成商品信息，再生成并选择创意方向。</p> : null}
    <div className="stage-context-list"><span>本步骤内容</span>{step.stages.map((stage) => <button type="button" className={stage === activeStage ? "is-current" : ""} key={stage} onClick={() => onSelect?.(stage)}>{userStageLabel(stage)}<small>{stage === "anchors" && visualSetup ? visualSetupStatusLabel(visualSetup.status) : stageStatusLabel(project.stageStates?.[stage].status ?? "draft")}</small></button>)}</div>
    {visualSetup ? <><p className="stage-context-copy">{visualSetup.status === "ready-to-complete" ? "全部设置已准备完成，等待你确认并继续。" : visualSetup.status === "completed" ? "人物与场景已经完成。" : "逐一确认产品、人物和场景后即可继续。"}</p><div className="stage-context-list"><span>确认进度</span><a href="#anchor-product">产品图<small>{visualSetup.productConfirmed ? "已确认" : "待确认"}</small></a><a href="#anchor-characters">人物<small>{visualSetup.characterConfirmed ? "已确认" : `${visualSetup.characterStatuses.filter((item) => item.status !== "confirmed").length} 项待确认`}</small></a><a href="#anchor-scenes">场景<small>{visualSetup.scenesConfirmed ? "已确认" : `${visualSetup.sceneStatuses.filter((item) => item.status !== "confirmed").length} 项待确认`}</small></a></div></> : null}
    {(activeStage === "storyboard" || activeStage === "keyframes" || activeStage === "video") ? <div className="stage-shot-navigator"><span>镜头列表</span>{project.shots.map((shot) => <a key={shot.id} href={`#${activeStage}-shot-${shot.id}`}>镜头 {String(shot.index).padStart(2, "0")}<small>{shot.durationSec} 秒</small></a>)}</div> : null}
    <footer className="stage-project-summary"><small>{project.brief.productName}</small><strong>{constraints.shotCount} 镜头 · {constraints.targetDurationSec} 秒 · {constraints.aspectRatio}</strong></footer>
  </aside>;
}

export function StageInspector({ project, activeStage, state, busy, onLock, onOpenModels, canConfirm = true, open, onClose, children }: { project: GenerationProject; activeStage: StageId; state: StageState; busy: boolean; onLock: () => void; onOpenModels: () => void; canConfirm?: boolean; open?: boolean; onClose?: () => void; children?: ReactNode }) {
  const states = project.stageStates!;
  const allowed = canRunStage(states, activeStage);
  const visualSetup = activeStage === "anchors" ? deriveVisualSetupStageState(project) : null;
  const remaining = remainingTasks(project, activeStage, state);
  const next = visualSetup
    ? visualSetup.status === "completed" ? "制作分镜" : "确认这些设定并开始制作分镜"
    : nextStep(activeStage, state);
  const resource = STAGE_RESOURCE[activeStage];
  const record = currentResourceVersion(project.resourceVersions ?? [], resource.resourceId);
  const impact = record ? calculateDependencyImpact(project.dependencyGraph ?? [], resource.resourceId, record.version, record.version + 1) : null;
  const blockers = getActionBlockers(project, actionForStage(activeStage));
  const currentStatusLabel = visualSetup ? visualSetupStatusLabel(visualSetup.status) : stageStatusLabel(state.status);
  return <aside className={`stage-inspector workspace-column workspace-column--right${open ? " is-open" : ""}`} aria-label="步骤状态">
    <header><div><span>制作状态</span><h2>{userStageLabel(activeStage)}</h2></div>{onClose ? <button type="button" className="stage-sheet-close" aria-label="关闭状态面板" onClick={onClose}>×</button> : null}</header>
    <section className="stage-inspector-status"><div><span>当前状态</span><strong className={`is-${state.status}`}>{currentStatusLabel}</strong></div></section>
    {visualSetup && ["ready-to-complete", "completed"].includes(visualSetup.status) ? <section className="stage-inspector-section"><h3>完成情况</h3><div className="visual-setup-checklist"><span>✓ 产品</span><span>✓ 主角</span><span>✓ 场景</span></div></section> : <section className="stage-inspector-section"><h3>还需要</h3><p>{remaining}</p></section>}
    <section className="stage-inspector-section"><h3>下一步</h3><p>{next}</p>{!allowed.allowed ? <div className="stage-gate-blocked">{friendlyGateReason(activeStage)}</div> : null}</section>
    {state.status === "ready" && canConfirm ? <GuardedActionButton className="stage-lock-button" blockers={blockers} busy={busy} busyLabel="确认中…" onAction={onLock}>{confirmLabel(activeStage)}</GuardedActionButton> : null}
    {(visualSetup ? visualSetup.status === "completed" : state.status === "locked") ? <div className="stage-locked-note">这一步已经确认，后续生成会继续使用当前内容。</div> : null}
    <details className="stage-provider-details"><summary>生成详情</summary><p>{record ? `已保存第 ${record.version} 次内容记录。` : "尚未生成内容记录。"}</p>{impact?.affectedStages.length ? <p>再次修改会让后续 {impact.affectedStages.length} 个步骤需要更新。</p> : null}<button type="button" onClick={onOpenModels}>模型设置</button></details>
    {children}
  </aside>;
}

function actionForStage(stage: StageId): WorkflowAction {
  return ({ brief: "CONFIRM_PRODUCT", creative: "GENERATE_CHARACTER", anchors: "CONFIRM_VISUAL_SETUP", storyboard: "CONFIRM_STORYBOARD", keyframes: "GENERATE_VIDEO", video: "GENERATE_FINAL", final: "GENERATE_FINAL" } as const)[stage];
}

export function stageStatusLabel(status: StageState["status"]): string {
  return ({ draft: "未开始", running: "生成中", repairing: "正在整理", ready: "待确认", locked: "已确认", outdated: "需要更新", failed: "生成失败", blocked: "未开始" } as const)[status];
}

function majorStatus(states: StageState[]): StageState["status"] {
  if (states.some((state) => state.status === "failed")) return "failed";
  if (states.some((state) => state.status === "repairing")) return "repairing";
  if (states.some((state) => state.status === "running")) return "running";
  if (states.some((state) => state.status === "outdated")) return "outdated";
  if (states.every((state) => state.status === "locked")) return "locked";
  if (states.some((state) => state.status === "ready")) return "ready";
  return "draft";
}

function resolveMajorTarget(stages: StageId[], states: StageStates, active: StageId): StageId {
  if (stages.includes(active)) return active;
  return stages.find((stage) => !["locked", "blocked"].includes(states[stage].status)) ?? stages.at(-1)!;
}

function userStageLabel(stage: StageId) {
  return ({ brief: "商品信息", creative: "创意方向", anchors: "人物与场景", storyboard: "文字分镜", keyframes: "关键帧", video: "视频生成", final: "成片检查" } as const)[stage];
}

function remainingTasks(project: GenerationProject, stage: StageId, state: StageState) {
  if (stage === "anchors") {
    const visualSetup = deriveVisualSetupStageState(project);
    return visualSetup.blockers.length ? visualSetup.blockers.map((item) => item.title.replace("还需要", "")).join("、") : "全部设置已准备完成";
  }
  if (state.status === "locked") return "没有待办";
  if (stage === "brief") return "保存商品信息并生成创意";
  if (stage === "creative") return project.creativeWorkspace ? "选择并确认一套创意" : "生成三套创意方向";
  if (stage === "storyboard") return "检查镜头数量、节奏和内容";
  if (stage === "keyframes") return "生成并确认当前镜头关键帧";
  if (stage === "video") return "生成选中镜头的视频";
  return "检查并导出成片";
}

function nextStep(stage: StageId, state: StageState) {
  if (stage === "anchors") return state.status === "locked" ? "制作分镜" : "确认这些设定并开始制作分镜";
  if (state.status !== "locked") return `完成并确认${userStageLabel(stage)}`;
  return ({ brief: "选择创意方向", creative: "生成人物与场景", anchors: "生成文字分镜", storyboard: "制作当前镜头关键帧", keyframes: "生成视频", video: "合成并检查成片", final: "项目已完成" } as const)[stage];
}

function visualSetupStatusToStageStatus(status: ReturnType<typeof deriveVisualSetupStageState>["status"]): StageState["status"] {
  return ({ "not-started": "draft", "in-progress": "draft", "ready-to-complete": "ready", completed: "locked", outdated: "outdated" } as const)[status];
}

function confirmLabel(stage: StageId) {
  return ({ brief: "确认商品信息", creative: "确认创意", anchors: "确认视觉设定", storyboard: "确认分镜并继续", keyframes: "确认关键帧", video: "确认视频", final: "确认成片" } as const)[stage];
}

function friendlyGateReason(stage: StageId) {
  return ({ brief: "", creative: "请先确认商品信息。", anchors: "请先确认创意方向。", storyboard: "请先确认视觉设定。", keyframes: "请先确认文字分镜。", video: "请先确认关键帧。", final: "请先确认视频。" } as const)[stage];
}
