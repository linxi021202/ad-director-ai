"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelSettingsSheet, type ModelSettingsStatus, type ProviderId } from "@/components/ModelSettingsSheet";
import { ModelSettingsTrigger } from "@/components/model-settings/ModelSettingsTrigger";
import { useModelSettingsStatus } from "@/components/model-settings/useModelSettingsStatus";
import { AIModeBadge, type AITraceStatus } from "@/components/AIModeBadge";
import { readClientApiResponse, type ClientApiResponse } from "@/lib/api/clientResponse";
import { CinematicWorkspaceBackground } from "@/components/workspace/CinematicWorkspaceBackground";
import { WorkflowFlowRail, idleWorkflowSteps, type WorkflowStepKey, type WorkflowStepState, type WorkflowStepStatus } from "@/components/WorkflowFlowRail";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { CallLogDrawer } from "@/components/workspace/CallLogDrawer";
import { UsageGuideSheet } from "@/components/workspace/UsageGuideSheet";
import { ProductImageUploader } from "@/components/ProductImageUploader";
import { buildProductAssetCollection, getProjectProductAssets, normalizeProductAssetState, removeProductImage, setMainProductImage } from "@/lib/productImages";
import { StageContextPanel, StageDirectorRail, StageInspector, stageStatusLabel } from "@/components/StageDirectorRail";
import { VisualAnchorsCanvas } from "@/components/VisualAnchorsCanvas";
import { CreativeCandidateGrid } from "@/components/creative/CreativeCandidateGrid";
import { KeyframeStageWorkspace } from "@/components/KeyframeStageWorkspace";
import { generateProjectKeyframes } from "@/lib/image/keyframeGenerationClient";
import { creativeStageStatusLabel, deriveCreativeStageState } from "@/lib/creative/creativeStageState";
import { StoryboardTimeline } from "@/components/storyboard/StoryboardTimeline";
import { buildOptimizedVideoPrompt, resolveHeroShot } from "@/lib/heroVideo";
import type { AdStrategy, AspectRatio, GenerationEvent, GenerationProject, ProductBrief, StageId, StageStates, StoryboardShot, VisualAnchorCandidateKind } from "@/lib/schemas/project";
import { normalizeProjectDuration } from "@/lib/projectDuration";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_RESOURCE,
  calculateDependencyImpact,
  currentResourceVersion,
  ensureStageWorkflow,
  type DependencyImpact
} from "@/lib/workflow/stageGates";
import { currentMasterAssetId, getVisualAnchorReadiness, getVisualAnchorResourceId, getVisualAnchorSelection } from "@/lib/visual/visualAnchors";
import { deriveVisualSetupStageState, visualSetupStatusLabel } from "@/lib/visual/visualSetupStage";
import {
  saveProjectBriefWithConflictRetry,
  type ProjectPatchData
} from "@/lib/projects/clientMutations";
import { clearProjectGenerationEvents } from "@/lib/projects/clientGenerationEvents";
import { deriveShotPromptProgress } from "@/lib/workflow/shotPromptProgress";
import {
  DEFAULT_SHOT_DURATION_SEC,
  DEFAULT_TARGET_DURATION_SEC,
  MAX_SHOT_COUNT,
  MAX_SHOT_DURATION_SEC,
  MIN_SHOT_COUNT,
  MIN_SHOT_DURATION_SEC,
  allocateShotDurations,
  clampShotCount,
  clampTargetDuration,
  getAllowedTargetDurationRange,
  getEffectiveShotCount,
  getProjectDurationSec
} from "@/lib/video/shotConfig";

type GenerateWorkflowProps = {
  project: GenerationProject;
  aiStatus: AITraceStatus;
  canCreateProject: boolean;
  projectVersion: number;
};

type GenerationMode = "template" | "custom";
type BriefSaveStatus = "draft" | "saving" | "saved" | "dirty" | "error";
type BriefDraft = {
  brief: ProductBrief;
  shotCount: number;
  targetDurationSec: number;
};
type AnchorVersionIntent = {
  kind: VisualAnchorCandidateKind;
  targetId: string;
  candidateId: string;
  label: string;
  impact: DependencyImpact;
};
type CallSelection = {
  deepseek: boolean;
  qwenImage: boolean;
  wan: boolean;
};

type ProviderDiagnostic = {
  code: string;
  title: string;
  detail: string;
  hint: string;
};

type ApiResponse<T> = ClientApiResponse<T>;
type PromptExpansionData = {
  shots: StoryboardShot[];
  processedShotIds: string[];
  remainingShotIds: string[];
  completedCount: number;
  totalCount: number;
  continuationRequired: boolean;
  failures: string[];
};

type WanVideoAsset = { publicUrl: string; shotId: string; source: "wan-api" };
type WanVideoData = {
  status: "running" | "qa-review" | "needs-review" | "completed";
  eventId: string;
  taskId?: string;
  asset?: WanVideoAsset;
};

type GenerateImagesData = {
  status: "running" | "completed";
  eventId: string;
  generatedShots?: number;
  requestedShots?: number;
  images: Array<{
    shotId: string;
    frameId?: string;
    imageUrl?: string;
    localUrl?: string;
    requestId?: string;
    size?: string;
    provider: string;
    model: string;
    latencyMs: number;
    cacheStatus: string;
    fallbackUsed: boolean;
    fallbackReason?: string | null;
    status?: "qa-review" | "ready" | "needs-review" | "fallback";
    errorCode?: string | null;
    qaResult?: { overallPassed: boolean; attempt: number; issues: string[] } | null;
    diagnostic?: ProviderDiagnostic | null;
  }>;
  failedShots: Array<{ shotId: string; fallbackReason: string | null; diagnostic?: ProviderDiagnostic | null }>;
};

const chain = ["简报", "策略", "分镜", "关键帧", "主镜头", "合成"];
const routes = ["DeepSeek → 策略 / 分镜 / 提示词", "Qwen-Image → 关键帧", "Wan 2.7 → 广告视频", "Remotion → 成片合成"];
function isProviderDiagnostic(value: unknown): value is ProviderDiagnostic {
  return Boolean(
    value &&
      typeof value === "object" &&
      "title" in value &&
      "detail" in value &&
      "hint" in value
  );
}

function getProviderDiagnostic(response: ApiResponse<unknown>): ProviderDiagnostic | null {
  const trace = response.trace;
  if (!trace || typeof trace !== "object" || !("diagnostic" in trace)) return null;
  const diagnostic = (trace as { diagnostic?: unknown }).diagnostic;
  return isProviderDiagnostic(diagnostic) ? diagnostic : null;
}

function formatDeepSeekTrace(stage: "策略" | "分镜", response: ApiResponse<unknown>) {
  if (!response.fallbackUsed) return `DeepSeek ${stage}｜真实文本完成`;
  const diagnostic = getProviderDiagnostic(response);
  if (!diagnostic) return `DeepSeek ${stage}｜已回退模板｜原因未识别｜可重新执行所选调用`;
  return `DeepSeek ${stage}｜已回退模板｜${diagnostic.title}｜${diagnostic.hint}`;
}

function formatQwenImageTrace(data: GenerateImagesData) {
  const failedImages = data.images.filter((image) => image.fallbackUsed || image.status === "needs-review");
  if (failedImages.length === 0) {
    return `Qwen-Image｜${data.images.length} 张关键帧通过一致性检查｜${data.images[0]?.model ?? "qwen-image"}`;
  }

  const firstDiagnostic = failedImages.find((image) => image.diagnostic)?.diagnostic;
  if (!firstDiagnostic) {
    return `Qwen-Image｜${data.images.length} 张请求｜${failedImages.length} 张回退占位图｜原因未识别｜请检查百炼配置后重试`;
  }

  return `Qwen-Image｜${data.images.length} 张请求｜${failedImages.length} 张回退占位图｜${firstDiagnostic.title}｜${firstDiagnostic.hint}`;
}

function selectedProvidersReady(selection: CallSelection, status: ModelSettingsStatus | null) {
  if (!status) return false;
  if (selection.deepseek && !status.deepseek.configured) return false;
  if (selection.qwenImage && !status.qwenImage.configured) return false;
  if (selection.wan && !status.wan.apiAvailable) return false;
  return selection.deepseek || selection.qwenImage || selection.wan;
}

export function GenerateWorkflow({ project, projectVersion, aiStatus, canCreateProject }: GenerateWorkflowProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeStage = parseStageId(searchParams.get("stage"));
  const initialProject = ensureStageWorkflow(normalizeProjectDuration(project));
  const initialShotCount = getEffectiveShotCount(initialProject);
  const initialTargetDurationSec = clampTargetDuration(
    initialShotCount,
    initialProject.targetDurationSec ?? initialProject.brief.durationSec ?? DEFAULT_TARGET_DURATION_SEC
  );
  const [generated, setGenerated] = useState(initialProject.status !== "draft");
  const activeVersionRef = useRef(projectVersion);
  const projectWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [briefDraft, setBriefDraft] = useState<BriefDraft>(() => ({
    brief: { ...initialProject.brief, durationSec: initialTargetDurationSec },
    shotCount: initialShotCount,
    targetDurationSec: initialTargetDurationSec
  }));
  const [briefSaveStatus, setBriefSaveStatus] = useState<BriefSaveStatus>(() => initialProject.briefStatus === "saved" ? "saved" : "draft");
  const [briefNotice, setBriefNotice] = useState<string | null>(null);
  const [shotCountSaving, setShotCountSaving] = useState(false);
  const shotCountOperationRef = useRef(false);
  const [shotCountElapsedSec, setShotCountElapsedSec] = useState(0);
  const [shotCountDialogOpen, setShotCountDialogOpen] = useState(false);
  const [requestedShotCount, setRequestedShotCount] = useState(() => initialShotCount);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStepState>(() => workflowFromProject(initialProject));
  const workflowStepsRef = useRef<WorkflowStepState>(workflowFromProject(initialProject));
  const [mode, setMode] = useState<GenerationMode>("template");
  const [selection, setSelection] = useState<CallSelection>({ deepseek: true, qwenImage: true, wan: true });
  const [isGenerating, setIsGenerating] = useState(false);
  const [creativeOperation, setCreativeOperation] = useState<"idle" | "generate" | "regenerate" | "select" | "confirm">("idle");
  const [error, setError] = useState<string | null>(null);
  const [traceLabel, setTraceLabel] = useState(() => initialTraceLabel(initialProject.generationEvents));
  const [callTrace, setCallTrace] = useState<string[]>(() => generationEventsToTrace(initialProject.generationEvents));
  const [activeProject, setActiveProject] = useState<GenerationProject>(initialProject);
  const [stageLocking, setStageLocking] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [briefVersionImpact, setBriefVersionImpact] = useState<DependencyImpact | null>(null);
  const [anchorBusyTarget, setAnchorBusyTarget] = useState<string | null>(null);
  const [anchorVersionIntent, setAnchorVersionIntent] = useState<AnchorVersionIntent | null>(null);
  const [liveKeyframes, setLiveKeyframes] = useState<GenerateImagesData["images"]>(() => projectKeyframesToImages(initialProject));
  const [keyframeBusyShotId, setKeyframeBusyShotId] = useState<string | null>(null);
  const [keyframeError, setKeyframeError] = useState<string | null>(null);
  const [selectedKeyframeShotId, setSelectedKeyframeShotId] = useState<string | undefined>(initialProject.shots[0]?.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState<ProviderId | undefined>();
  const [settingsGuidance, setSettingsGuidance] = useState<string | null>(null);
  const [usageGuideOpen, setUsageGuideOpen] = useState(false);
  const [usageGuideIntro, setUsageGuideIntro] = useState(false);
  const { status: modelStatus, setStatus: setModelStatus } = useModelSettingsStatus();
  const previewProject = useMemo<GenerationProject>(() => ({
    ...activeProject,
    brief: {
      ...activeProject.brief,
      aspectRatio: briefDraft.brief.aspectRatio
    }
  }), [activeProject, briefDraft.brief.aspectRatio]);

  useEffect(() => {
    const revealKey = "ad-director-workspace-reveal";
    const shouldReveal = document.documentElement.dataset.workspaceReveal === "pending"
      || window.sessionStorage.getItem(revealKey) === "pending";
    if (!shouldReveal) return;
    document.documentElement.dataset.workspaceReveal = "active";
    window.sessionStorage.removeItem(revealKey);
    const timer = window.setTimeout(() => {
      delete document.documentElement.dataset.workspaceReveal;
    }, 380);
    return () => {
      window.clearTimeout(timer);
      delete document.documentElement.dataset.workspaceReveal;
    };
  }, []);

  useEffect(() => {
    const key = "ad-director-usage-guide-seen-v1";
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, "1");
    setUsageGuideIntro(true);
    setUsageGuideOpen(true);
  }, []);

  function trackServerVersion(version: number) {
    activeVersionRef.current = Math.max(activeVersionRef.current, version);
  }

  async function refreshProductStateAfterUpload(version: number) {
    trackServerVersion(version);
    try {
      const snapshot = await fetchServerProject(activeProject.id);
      const serverBrief = normalizeProductAssetState(snapshot.project.brief);
      const serverAssets = getProjectProductAssets(serverBrief);
      trackServerVersion(snapshot.version);
      setActiveProject((current) => current.id === snapshot.project.id
        ? normalizeProjectDuration({ ...snapshot.project, brief: serverBrief })
        : current);
      setBriefDraft((current) => ({
        ...current,
        brief: {
          ...current.brief,
          productImages: serverBrief.productImages,
          productAssetIds: serverAssets.assetIds,
          ...(serverAssets.primaryAssetId ? { primaryProductAssetId: serverAssets.primaryAssetId } : {})
        }
      }));
    } catch {
      setError("产品图片已保存，但服务器状态刷新失败，请稍后重试。");
    }
  }

  function applyWorkflowState(next: WorkflowStepState) {
    workflowStepsRef.current = next;
    setWorkflowSteps(next);
  }

  function updateWorkflowState(patch: Partial<WorkflowStepState>) {
    const next = { ...workflowStepsRef.current, ...patch };
    applyWorkflowState(next);
    return next;
  }

  function queueProjectPatch(projectId: string, patch: Record<string, unknown>) {
    const operation = projectWriteQueueRef.current.then(async () => {
      const saved = await patchServerProject(projectId, patch);
      trackServerVersion(saved.version);
      return saved;
    });
    projectWriteQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }

  function commitWorkflow(next: WorkflowStepState) {
    applyWorkflowState(next);
    void queueProjectPatch(activeProject.id, { workflowSteps: next }).catch(() => undefined);
  }

  function patchWorkflow(patch: Partial<WorkflowStepState>) {
    const next = updateWorkflowState(patch);
    void queueProjectPatch(activeProject.id, { workflowSteps: next }).catch(() => undefined);
  }

  function setStep(key: WorkflowStepKey, status: WorkflowStepStatus) { patchWorkflow({ [key]: status }); }

  function handleModeChange(nextMode: GenerationMode) {
    setMode(nextMode);
    setGenerated(false);
    setIsGenerating(false);
    const nextWorkflow = { ...idleWorkflowSteps, brief: briefSaveStatus === "saved" ? "completed" as const : "pending" as const };
    applyWorkflowState(nextWorkflow);
    if (briefSaveStatus === "saved") {
      void queueProjectPatch(activeProject.id, { workflowSteps: nextWorkflow }).catch(() => undefined);
    }
    setError(null);
  }

  function updateBrief(patch: Partial<ProductBrief>) {
    setGenerated(false);
    setError(null);
    setBriefNotice(null);
    setBriefDraft((current) => ({ ...current, brief: { ...current.brief, ...patch } }));
    setBriefSaveStatus("dirty");
    updateWorkflowState({ brief: "pending" });
  }

  function updateShotCount(rawValue: number) {
    if (shotCountSaving || isGenerating) return;
    const shotCount = clampShotCount(rawValue);
    setBriefDraft((current) => {
      if (shotCount === current.shotCount) return current;
      const nextTarget = clampTargetDuration(shotCount, current.targetDurationSec);
      if (nextTarget !== current.targetDurationSec) {
        const range = getAllowedTargetDurationRange(shotCount);
        setBriefNotice(`${shotCount} 个分镜支持 ${range.min}–${range.max} 秒，目标时长已调整为 ${nextTarget} 秒。`);
      } else {
        setBriefNotice(null);
      }
      return {
        ...current,
        shotCount,
        targetDurationSec: nextTarget,
        brief: { ...current.brief, durationSec: nextTarget }
      };
    });
    setBriefSaveStatus("dirty");
    updateWorkflowState({ brief: "pending" });
  }

  function updateTargetDuration(rawValue: number) {
    const targetDurationSec = clampTargetDuration(briefDraft.shotCount, rawValue);
    setBriefDraft((current) => ({
      ...current,
      targetDurationSec,
      brief: { ...current.brief, durationSec: targetDurationSec }
    }));
    setBriefSaveStatus("dirty");
    setBriefNotice(null);
    updateWorkflowState({ brief: "pending" });
  }

  async function saveBrief(createVersion = false): Promise<GenerationProject | undefined> {
    if (briefSaveStatus === "saving" || isGenerating) return;
    if (activeProject.stageStates?.brief.status === "locked" && !createVersion) {
      const resource = currentResourceVersion(activeProject.resourceVersions ?? [], "brief");
      const currentResourceVersionNumber = resource?.version ?? 1;
      setBriefVersionImpact(calculateDependencyImpact(
        activeProject.dependencyGraph ?? [],
        "brief",
        currentResourceVersionNumber,
        currentResourceVersionNumber + 1
      ));
      return;
    }
    const savedTargetDuration = activeProject.targetDurationSec ?? activeProject.brief.durationSec;
    const targetDurationChanged = briefDraft.targetDurationSec !== savedTargetDuration;
    if (hasGeneratedStoryboard(activeProject) && targetDurationChanged) {
      const confirmed = window.confirm("修改目标时长将重新分配所有镜头的时长，并需要重新生成最终成片。");
      if (!confirmed) return;
    }
    setBriefSaveStatus("saving");
    setError(null);
    try {
      await projectWriteQueueRef.current;
      const saved = createVersion
        ? await saveProjectBriefWithConflictRetry(activeProject.id, activeVersionRef.current, { ...briefDraft, createVersion: true })
        : await saveProjectBriefWithConflictRetry(activeProject.id, activeVersionRef.current, briefDraft);
      const refreshed = ensureStageWorkflow(normalizeProjectDuration(saved.project));
      const savedShotCount = getEffectiveShotCount(refreshed);
      const savedTarget = refreshed.targetDurationSec ?? refreshed.brief.durationSec;
      trackServerVersion(saved.version);
      setActiveProject(refreshed);
      setBriefDraft({
        brief: { ...refreshed.brief, durationSec: savedTarget },
        shotCount: savedShotCount,
        targetDurationSec: savedTarget
      });
      applyWorkflowState(workflowFromProject(refreshed));
      setBriefSaveStatus("saved");
      setBriefVersionImpact(null);
      setBriefNotice(null);
      if (activeStage === "brief") router.replace(`/generate?projectId=${encodeURIComponent(refreshed.id)}`);
      else router.replace(stageUrl(refreshed.id, activeStage));
      return refreshed;
    } catch (saveError) {
      setBriefSaveStatus("error");
      setError(saveError instanceof Error ? saveError.message : "广告需求保存失败，请重试。");
    }
  }

  function requestGeneratedShotCountChange() {
    if (shotCountSaving || isGenerating) return;
    setRequestedShotCount(getEffectiveShotCount(activeProject));
    setShotCountDialogOpen(true);
  }

  async function regenerateShotCount() {
    if (shotCountOperationRef.current || shotCountSaving || isGenerating) return;
    const shotCount = clampShotCount(requestedShotCount);
    if (shotCount === getEffectiveShotCount(activeProject)) {
      setShotCountDialogOpen(false);
      return;
    }

    shotCountOperationRef.current = true;
    setShotCountSaving(true);
    setShotCountElapsedSec(0);
    const operationStartedAt = Date.now();
    const elapsedTimer = window.setInterval(() => {
      setShotCountElapsedSec(Math.max(1, Math.floor((Date.now() - operationStartedAt) / 1_000)));
    }, 1_000);
    setError(null);
    setTraceLabel(`正在重新生成 ${shotCount} 个分镜`);
    try {
      await resetGenerationLogForNewRun(activeProject.id);
      const targetDurationSec = clampTargetDuration(shotCount, briefDraft.targetDurationSec);
      const shotDurationPlan = allocateShotDurations(shotCount, targetDurationSec);
      const response = await postApi<{ shots: StoryboardShot[] }>("/api/generate-storyboard", {
        projectId: activeProject.id,
        brief: { ...activeProject.brief, durationSec: targetDurationSec },
        strategy: activeProject.strategy,
        requestedShotCount: shotCount,
        targetDurationSec,
        shotDurationPlan,
        regenerateExisting: true
      });
      if (!response.success || !response.data?.shots) {
        throw new Error(response.error || "分镜数量调整失败，请重试。");
      }

      const snapshot = await fetchServerProject(activeProject.id);
      const refreshed = normalizeProjectDuration(snapshot.project);
      trackServerVersion(snapshot.version);
      setActiveProject(refreshed);
      applyWorkflowState(workflowFromProject(refreshed));
      setLiveKeyframes(projectKeyframesToImages(refreshed));
      setBriefDraft({
        brief: { ...refreshed.brief, durationSec: refreshed.targetDurationSec ?? refreshed.brief.durationSec },
        shotCount: getEffectiveShotCount(refreshed),
        targetDurationSec: refreshed.targetDurationSec ?? refreshed.brief.durationSec
      });
      setBriefSaveStatus("saved");
      setGenerated(true);
      setShotCountDialogOpen(false);
      await refreshServerEvents(activeProject.id);
    } catch (saveError) {
      setTraceLabel("分镜数量调整失败");
      setError(saveError instanceof Error ? saveError.message : "分镜数量调整失败，请重试。");
    } finally {
      window.clearInterval(elapsedTimer);
      shotCountOperationRef.current = false;
      setShotCountSaving(false);
    }
  }
  function resetBriefToTemplate() {
    setGenerated(false);
    setError(null);
    const restored = normalizeProjectDuration(project);
    const shotCount = getEffectiveShotCount(restored);
    const targetDurationSec = restored.targetDurationSec ?? restored.brief.durationSec;
    setBriefDraft({ brief: { ...restored.brief, durationSec: targetDurationSec }, shotCount, targetDurationSec });
    setBriefSaveStatus("dirty");
    setBriefNotice("已恢复模板内容，保存后才会应用到项目。");
    updateWorkflowState({ brief: "pending" });
  }
  function toggleSelection(key: keyof CallSelection) {
    setSelection((current) => ({ ...current, [key]: !current[key] }));
  }

  function openModelSettings(provider?: ProviderId, guidance?: string) {
    setSettingsProvider(provider);
    setSettingsGuidance(guidance ?? null);
    setSettingsOpen(true);
  }

  function missingRequiredProvider() {
    if (mode !== "custom") return null;
    if (selection.deepseek && !modelStatus?.deepseek.configured) return { provider: "deepseek" as const, guidance: "生成策略与分镜前需要配置 DeepSeek。" };
    if (selection.qwenImage && !modelStatus?.qwenImage.configured) return { provider: "qwen-image" as const, guidance: "生成关键帧前需要配置 Qwen-Image。" };
    if (selection.wan && !modelStatus?.wan.apiAvailable) return { provider: "qwen-image" as const, guidance: "调用 Wan 2.7 前需要配置百炼 API Key，并在服务端启用真实视频生成。" };

    return null;
  }

  const refreshServerEvents = useCallback(async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/events`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { data?: { events?: GenerationEvent[] } };
      const events = payload.data?.events ?? [];
      setCallTrace(generationEventsToTrace(events));
      setTraceLabel(initialTraceLabel(events));
      setActiveProject((current) => current.id === projectId ? { ...current, generationEvents: events } : current);
    } catch {
      // Keep the last server-backed snapshot visible while a refresh is unavailable.
    }
  }, []);

  async function resetGenerationLogForNewRun(projectId: string) {
    await projectWriteQueueRef.current;
    const result = await clearProjectGenerationEvents(projectId);
    trackServerVersion(result.version);
    setCallTrace([]);
    setActiveProject((current) => current.id === projectId ? { ...current, generationEvents: [] } : current);
  }

  useEffect(() => {
    void refreshServerEvents(activeProject.id);
  }, [activeProject.id, refreshServerEvents]);

  useEffect(() => {
    const event = [...(project.generationEvents ?? [])].reverse().find((item) =>
      item.provider === "qwen-image" &&
      item.action === "生成关键帧批次" &&
      ["queued", "running", "qa-review"].includes(item.status)
    );
    if (!event) return;

    let cancelled = false;
    setIsGenerating(true);
    updateWorkflowState({ keyframes: "running" });
    setTraceLabel("正在恢复 Qwen-Image 关键帧任务");
    void pollQwenImagesUntilComplete(project.id, event.id, (elapsedSeconds, completed, total) => {
      if (cancelled) return;
      setTraceLabel(elapsedSeconds >= 90 ? `生成时间较长，任务仍在处理中（${completed}/${total}）` : `Qwen-Image 正在生成关键帧（${completed}/${total}，已等待 ${elapsedSeconds} 秒）`);
      void refreshServerEvents(project.id);
    }).then(async (completed) => {
      if (cancelled) return;
      setLiveKeyframes(completed.images);
      updateWorkflowState({ keyframes: imageWorkflowStatus(completed.images) });
      const snapshot = await fetchServerProject(project.id);
      if (!cancelled) {
        trackServerVersion(snapshot.version);
        setActiveProject(normalizeProjectDuration(snapshot.project));
        setGenerated(true);
      }
    }).catch((resumeError) => {
      if (!cancelled) {
        setError(resumeError instanceof Error ? resumeError.message : "关键帧任务恢复失败。");
        updateWorkflowState({ keyframes: "failed" });
      }
    }).finally(() => {
      if (!cancelled) {
        setIsGenerating(false);
        void refreshServerEvents(project.id);
      }
    });

    return () => {
      cancelled = true;
    };
    // Resume only the task that was present in the server-rendered project snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function handleGenerate() {
    const requestedShotCount = getEffectiveShotCount(activeProject);
    const targetDurationSec = activeProject.targetDurationSec ?? activeProject.brief.durationSec;
    const shotDurationPlan = allocateShotDurations(requestedShotCount, targetDurationSec);
    setError(null);
    if (briefSaveStatus !== "saved") {
      setError("请先保存广告需求。");
      return;
    }
    const missing = missingRequiredProvider();
    if (missing) {
      setError(missing.guidance);
      openModelSettings(missing.provider, missing.guidance);
      return;
    }
    setGenerated(false);
    commitWorkflow({ brief: "completed", strategy: mode === "template" || selection.deepseek ? "running" : "completed", storyboard: "pending", keyframes: "pending", heroShot: "pending", render: "pending" });
    if (mode === "template") {
      setIsGenerating(true);
      const templateWorkflow: WorkflowStepState = {
        brief: "completed",
        strategy: "completed",
        storyboard: "completed",
        keyframes: "fallback",
        heroShot: "fallback",
        render: "fallback"
      };
      const templateProject = {
        ...activeProject,
        workflowSteps: templateWorkflow,
        status: "completed" as const,
        updatedAt: new Date().toISOString()
      };
      setActiveProject(templateProject);
      setTraceLabel("本地模板生成中");
      commitWorkflow(templateWorkflow);
      setTraceLabel("本地模板完成");
      await queueProjectPatch(templateProject.id, {
        brief: templateProject.brief,
        strategy: templateProject.strategy,
        shots: templateProject.shots,
        prompts: templateProject.prompts,
        workflowSteps: templateWorkflow,
        keyframes: [],
        status: "completed"
      });
      setLiveKeyframes([]);
      setGenerated(true);
      setIsGenerating(false);
      return;
    }

    if (!selection.deepseek && !selection.qwenImage && !selection.wan) {
      setError("请至少选择一个真实调用节点，或切回使用模板。");
      commitWorkflow(idleWorkflowSteps);
      return;
    }

    setIsGenerating(true);
    setTraceLabel("正在开始新一轮调用");

    try {
      await resetGenerationLogForNewRun(activeProject.id);
      setTraceLabel("真实调用中");
      let workingProject = activeProject;
      let generatedImages: GenerateImagesData["images"] = liveKeyframes;
      if (selection.deepseek) {
        setTraceLabel("DeepSeek 文本调用中");
        const strategyResponse = await postApi<{ strategy: AdStrategy }>("/api/generate-strategy", { projectId: workingProject.id, brief: workingProject.brief, requestedShotCount, targetDurationSec, shotDurationPlan });
        if (!strategyResponse.success || !strategyResponse.data?.strategy) {
          throw new Error(strategyResponse.error || "策略生成失败，请检查 DeepSeek 配置。");
        }
        patchWorkflow({ strategy: strategyResponse.fallbackUsed ? "fallback" : "completed", storyboard: "running" });

        const storyboardResponse = await postApi<{ shots: StoryboardShot[] }>("/api/generate-storyboard", {
          projectId: workingProject.id,
          brief: workingProject.brief,
          strategy: strategyResponse.data.strategy,
          requestedShotCount,
          targetDurationSec,
          shotDurationPlan
        });
        if (!storyboardResponse.success || !storyboardResponse.data?.shots) {
          throw new Error(storyboardResponse.error || "分镜生成失败，请检查 DeepSeek 配置。");
        }
        patchWorkflow({ storyboard: storyboardResponse.fallbackUsed ? "fallback" : "completed", keyframes: selection.qwenImage ? "running" : "pending" });

        workingProject = {
          ...workingProject,
          strategy: strategyResponse.data.strategy,
          shots: storyboardResponse.data.shots,
          status: "completed",
          updatedAt: new Date().toISOString()
        };
        setActiveProject(workingProject);
      } else {
        patchWorkflow({ strategy: "completed", storyboard: "completed", keyframes: selection.qwenImage ? "running" : "pending" });
      }

      if (selection.qwenImage) {
        setStep("keyframes", "running");
        setTraceLabel("Qwen-Image 关键帧调用中");
        const imageResponse = await postApi<GenerateImagesData>("/api/generate-images", {
          projectId: workingProject.id,
          shots: workingProject.shots,
          mode: "all-shots",
          aspectRatio: workingProject.brief.aspectRatio,
          productImages: workingProject.brief.productImages ?? []
        });
        if (!imageResponse.success || !imageResponse.data) {
          throw new Error(imageResponse.error || "Qwen-Image 关键帧生成失败，请检查百炼配置。");
        }
        const completedImages = imageResponse.data.status === "running"
          ? await pollQwenImagesUntilComplete(
              workingProject.id,
              imageResponse.data.eventId,
              (elapsedSeconds, completed, total) => {
                setTraceLabel(elapsedSeconds >= 90 ? `生成时间较长，任务仍在处理中（${completed}/${total}）` : `Qwen-Image 正在生成关键帧（${completed}/${total}，已等待 ${elapsedSeconds} 秒）`);
                void refreshServerEvents(workingProject.id);
              }
            )
          : imageResponse.data;
        generatedImages = completedImages.images;
        patchWorkflow({ keyframes: imageWorkflowStatus(generatedImages), heroShot: selection.wan ? "running" : "pending" });
        setLiveKeyframes(generatedImages);
      }

      if (selection.wan) {
        const selectedHeroShot = resolveHeroShot(workingProject.shots, workingProject.heroShotId) ?? workingProject.shots[0];
        if (!selectedHeroShot) throw new Error("Wan 2.7 调用失败：项目没有可用的主镜头。");
        const heroKeyframe = generatedImages.find((image) => image.shotId === selectedHeroShot.id);
        const heroReferenceUrl = heroKeyframe?.localUrl || heroKeyframe?.imageUrl;
        if (!heroReferenceUrl) {
          throw new Error("Wan 2.7 I2V 需要当前主镜头关键帧作为唯一首帧。请先生成当前主镜头关键帧。");
        }
        if (heroKeyframe?.status !== "ready" || !heroKeyframe.qaResult?.overallPassed) {
          throw new Error("KEYFRAME_QA_REQUIRED：主镜头关键帧尚未通过一致性检查，不能进入 Wan 2.7。");
        }
        if (!(workingProject.brief.productImages ?? []).some((image) => image.role !== "logo" && (image.localUrl || image.remoteUrl || image.url))) {
          throw new Error("生成 Wan 2.7 I2V 首帧前需要至少一张已保存的真实产品图。请先在广告需求中上传产品主图。");
        }
        setTraceLabel("Wan 2.7 广告视频调用中");
        setStep("heroShot", "running");
        const videoResponse = await postApi<WanVideoData>("/api/projects/" + encodeURIComponent(workingProject.id) + "/wan-video", {
          shotId: selectedHeroShot.id,
          imageUrl: heroReferenceUrl,
          productImages: workingProject.brief.productImages ?? [],
          prompt: buildOptimizedVideoPrompt(selectedHeroShot),
          aspectRatio: workingProject.brief.aspectRatio,
          durationSec: Math.min(MAX_SHOT_DURATION_SEC, Math.max(MIN_SHOT_DURATION_SEC, Math.round(selectedHeroShot.durationSec || DEFAULT_SHOT_DURATION_SEC)))
        });
        if (!videoResponse.success || !videoResponse.data) {
          throw new Error(videoResponse.error || "Wan 2.7 广告视频生成失败，请检查百炼 Key、模型权限和账户状态。");
        }
        const completedVideo = videoResponse.data.asset
          ? videoResponse.data
          : await pollWanVideoUntilComplete(
              workingProject.id,
              videoResponse.data.eventId,
              (elapsedSeconds) => setTraceLabel(`Wan 2.7 正在生成视频（已等待 ${elapsedSeconds} 秒）`)
            );
        if (!completedVideo.asset) {
          throw new Error("Wan 2.7 任务已结束，但没有取得项目视频资产。");
        }
        setStep("heroShot", "completed");
      }

      const completedWorkflow: WorkflowStepState = {
        ...workflowStepsRef.current,
        keyframes: selection.qwenImage ? workflowStepsRef.current.keyframes : "fallback",
        heroShot: selection.wan ? workflowStepsRef.current.heroShot : "pending",
        render: "pending"
      };
      applyWorkflowState(completedWorkflow);
      const completedProjectStatus = Object.values(completedWorkflow).includes("needs-review") ? "needs-review" as const : "completed" as const;
      void queueProjectPatch(activeProject.id, { workflowSteps: completedWorkflow, status: completedProjectStatus }).catch((saveError) => {
        setError(saveError instanceof Error ? saveError.message : "项目状态保存失败。");
      });

      setGenerated(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "真实调用失败。请确认服务端环境变量已配置。不同 Key 不会在前端显示。");
      setTraceLabel("调用失败");
      const running = (Object.entries(workflowStepsRef.current).find(([, status]) => status === "running")?.[0] ?? "strategy") as WorkflowStepKey;
      const failedWorkflow = { ...workflowStepsRef.current, [running]: "failed" as const };
      applyWorkflowState(failedWorkflow);
      void queueProjectPatch(activeProject.id, { workflowSteps: failedWorkflow, status: "failed" }).catch(() => undefined);
    } finally {
      setIsGenerating(false);
      await refreshServerEvents(activeProject.id);
    }
  }

  function selectStage(stageId: StageId) {
    setContextOpen(false);
    setInspectorOpen(false);
    router.replace(stageUrl(activeProject.id, stageId), { scroll: false });
    if (stageId === "anchors") {
      void fetchServerProject(activeProject.id).then((snapshot) => applyProjectUpdate(snapshot)).catch(() => {
        setError("人物与场景页面刷新失败，请稍后重试。");
      });
    }
  }

  function applyProjectUpdate(saved: ProjectPatchData) {
    const refreshed = ensureStageWorkflow(normalizeProjectDuration(saved.project));
    trackServerVersion(saved.version);
    setActiveProject(refreshed);
    applyWorkflowState(workflowFromProject(refreshed));
    setLiveKeyframes(projectKeyframesToImages(refreshed));
    return refreshed;
  }

  async function postWorkflowAction(body: Record<string, unknown>, expectedVersion = activeVersionRef.current) {
    const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, expectedVersion })
    });
    const result = await readClientApiResponse<ProjectPatchData>(response);
    if (!response.ok || !result.success || !result.data) throw new Error(result.error || "阶段状态更新失败。");
    return applyProjectUpdate(result.data);
  }

  async function postCreativeAction(body: Record<string, unknown>, expectedVersion = activeVersionRef.current) {
    const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/creative-directions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, expectedVersion })
    });
    const result = await readClientApiResponse<ProjectPatchData>(response);
    if (!response.ok || !result.success || !result.data) throw new Error(result.error || "创意方向更新失败。");
    return applyProjectUpdate(result.data);
  }

  async function lockCurrentStage() {
    if (stageLocking) return;
    setStageLocking(true);
    setError(null);
    try {
      let refreshed = await postWorkflowAction({ action: "lock-stage", stageId: activeStage });
      if (activeStage === "storyboard") {
        refreshed = await expandStoryboardPrompts(refreshed);
      }
      const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(activeStage) + 1];
      setTraceLabel(`${STAGE_LABELS[activeStage]}已确认`);
      if (nextStage) selectStage(nextStage);
      else setActiveProject(refreshed);
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : "阶段锁定失败。");
    } finally {
      setStageLocking(false);
    }
  }

  async function expandStoryboardPrompts(source: GenerationProject, onlyShotId?: string) {
    let refreshed = source;
    const failures: string[] = [];
    const targets = source.shots.filter((shot) => !onlyShotId || shot.id === onlyShotId);
    for (const shot of targets) {
      setTraceLabel(`正在生成镜头 ${String(shot.index).padStart(2, "0")} 的详细提示词`);
      const expanded = await postApi<PromptExpansionData>("/api/generate-assets", {
        projectId: refreshed.id,
        brief: refreshed.brief,
        strategy: refreshed.strategy,
        shots: [shot],
        batchSize: 1
      });
      const snapshot = await fetchServerProject(refreshed.id);
      refreshed = applyProjectUpdate(snapshot);
      if (!expanded.success) {
        failures.push(`镜头 ${shot.index}`);
        continue;
      }
      setTraceLabel(`镜头 ${String(shot.index).padStart(2, "0")} 的提示词已保存`);
    }
    if (failures.length) throw new Error(`${failures.join("、")}生成未完成；其他成功镜头已保存，可单独重试失败镜头。`);
    return refreshed;
  }

  async function retryStoryboardPromptExpansion(shotId?: string) {
    if (stageLocking) return;
    setStageLocking(true);
    setError(null);
    try {
      const refreshed = await expandStoryboardPrompts(activeProject, shotId);
      const complete = refreshed.shots.every((shot) => refreshed.shotPromptPackages?.some((item) => item.shotId === shot.id && item.schemaVersion === 2 && item.inputFingerprint));
      setTraceLabel(complete ? "全部镜头提示词已生成" : "该镜头提示词已保存");
      if (complete) selectStage("keyframes");
    } catch (expansionError) {
      setError(expansionError instanceof Error ? expansionError.message : "提示词续跑失败，请稍后重试。");
    } finally {
      setStageLocking(false);
      await refreshServerEvents(activeProject.id);
    }
  }

  async function runCreativeStage() {
    if (isGenerating) return;
    if (!modelStatus?.deepseek.configured) {
      const guidance = "生成创意方向前需要配置 DeepSeek。";
      setError(guidance);
      openModelSettings("deepseek", guidance);
      return;
    }
    setIsGenerating(true);
    setCreativeOperation(activeProject.creativeWorkspace ? "regenerate" : "generate");
    setError(null);
    try {
      await postCreativeAction({ action: "generate" });
      setGenerated(true);
      setTraceLabel("三套创意方向已生成，等待选择");
      selectStage("creative");
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "创意方向生成失败。");
    } finally {
      setIsGenerating(false);
      setCreativeOperation("idle");
      await refreshServerEvents(activeProject.id);
    }
  }

  async function saveBriefAndGenerateCreative() {
    if (isGenerating || briefSaveStatus === "saving") return;
    setIsGenerating(true);
    setError(null);
    try {
      let current = briefSaveStatus === "saved" ? activeProject : await saveBrief();
      if (!current) return;
      if (current.stageStates?.brief.status !== "locked") {
        current = await postWorkflowAction({ action: "lock-stage", stageId: "brief" });
      }
      if (!modelStatus?.deepseek.configured) {
        const guidance = "商品信息已保存。配置 DeepSeek 后即可生成三套创意方向。";
        setError(guidance);
        openModelSettings("deepseek", guidance);
        selectStage("creative");
        return;
      }
      await postCreativeAction({ action: "generate" });
      setTraceLabel("三套创意方向已生成，等待选择");
      selectStage("creative");
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "商品信息保存或创意生成失败。");
    } finally {
      setIsGenerating(false);
      await refreshServerEvents(activeProject.id);
    }
  }

  async function selectCreativeCandidate(candidateId: string) {
    setCreativeOperation("select");
    try {
      await postCreativeAction({ action: "select", candidateId });
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "创意选择失败。");
    } finally {
      setCreativeOperation("idle");
    }
  }

  async function confirmCreativeCandidate(candidateId: string) {
    if (isGenerating) return;
    setIsGenerating(true);
    setCreativeOperation("confirm");
    setError(null);
    try {
      const confirmed = await postCreativeAction({ action: "confirm", candidateId });
      const prepared = await postAnchorAction({ action: "initialize" }, "initialize") ?? confirmed;
      selectStage("anchors");
      if (modelStatus?.qwenImage.configured) await generateAllVisualCandidates(prepared);
      else setError("创意已确认。配置 Qwen-Image 后即可生成人物与场景候选。");
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "创意确认失败。");
    } finally {
      setIsGenerating(false);
      setCreativeOperation("idle");
    }
  }

  async function postAnchorAction(body: Record<string, unknown>, busyTarget: string) {
    if (anchorBusyTarget) return null;
    setAnchorBusyTarget(busyTarget);
    setError(null);
    try {
      await projectWriteQueueRef.current;
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/visual-anchors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedVersion: activeVersionRef.current })
      });
      const result = await readClientApiResponse<ProjectPatchData>(response);
      if (!response.ok || !result.success || !result.data) {
        throw new Error(typeof result.error === "string" ? result.error : "视觉基准更新失败。");
      }
      const refreshed = applyProjectUpdate(result.data);
      await refreshServerEvents(activeProject.id);
      return refreshed;
    } finally {
      setAnchorBusyTarget(null);
    }
  }

  async function initializeVisualAnchors() {
    try {
      await postAnchorAction({ action: "initialize" }, "initialize");
      setTraceLabel("视觉基准需求已整理");
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "视觉基准需求整理失败。");
    }
  }

  async function generateVisualAnchorCandidates(kind: VisualAnchorCandidateKind, targetId: string, candidateIndex?: number) {
    if (!modelStatus?.qwenImage.configured) {
      const guidance = `生成${kind === "character" ? "人物" : "场景"}候选前需要配置 Qwen-Image。`;
      setError(guidance);
      openModelSettings("qwen-image", guidance);
      return;
    }
    try {
      await postAnchorAction({ action: "generate-candidates", kind, targetId, count: candidateIndex ? 1 : 3,
        ...(candidateIndex ? { candidateIndex } : {}) }, `generate:${kind}:${targetId}`);
      setTraceLabel(`${kind === "character" ? "人物" : "场景"}候选已生成，等待选择`);
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "视觉候选生成失败。");
    }
  }

  async function generateAllVisualCandidates(source: GenerationProject = activeProject) {
    if (!modelStatus?.qwenImage.configured) {
      const guidance = "生成人物与场景候选前需要配置 Qwen-Image。";
      setError(guidance);
      openModelSettings("qwen-image", guidance);
      return source;
    }
    let latest = source;
    const failures: string[] = [];
    const characters = latest.visualAnchorWorkspace?.requiredCharacterIds ?? [];
    const scenes = latest.visualAnchorWorkspace?.requiredSceneIds ?? [];
    for (const targetId of characters) {
      try {
        latest = await postAnchorAction({ action: "generate-candidates", kind: "character", targetId, count: 3 }, `generate:character:${targetId}`) ?? latest;
      } catch {
        failures.push("人物");
      }
    }
    for (const targetId of scenes) {
      try {
        latest = await postAnchorAction({ action: "generate-candidates", kind: "scene", targetId, count: 3 }, `generate:scene:${targetId}`) ?? latest;
      } catch {
        failures.push("场景");
      }
    }
    setTraceLabel(failures.length ? "部分视觉候选生成失败，可在对应模块重试" : "人物与场景候选已生成，等待选择");
    if (failures.length) setError(`${Array.from(new Set(failures)).join("和")}候选有部分失败，成功图片已保留，请在对应区域重试。`);
    return latest;
  }

  async function confirmVisualSelection() {
    if (anchorBusyTarget || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const visualSetup = deriveVisualSetupStageState(activeProject);
      if (!visualSetup.allItemsConfirmed) throw new Error(visualSetup.blockers[0]?.title ?? "人物与场景确认失败，请重试。");
      await postWorkflowAction({ action: "confirm-visual-setup" });
      const snapshot = await fetchServerProject(activeProject.id);
      applyProjectUpdate(snapshot);
      selectStage("storyboard");
      await runStoryboardStage();
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "人物与场景确认失败，请重试。");
    } finally {
      setIsGenerating(false);
    }
  }

  async function updateAnchorProductImages(nextImages: ProductBrief["productImages"]) {
    if (!nextImages || anchorBusyTarget || isGenerating) return;
    setAnchorBusyTarget("product-images");
    setError(null);
    try {
      const collection = buildProductAssetCollection(nextImages);
      const saved = await saveProjectBriefWithConflictRetry(activeProject.id, activeVersionRef.current, {
        brief: { ...activeProject.brief, productImages: nextImages, ...collection },
        shotCount: getEffectiveShotCount(activeProject),
        targetDurationSec: activeProject.targetDurationSec ?? activeProject.brief.durationSec,
        createVersion: true
      });
      const refreshed = applyProjectUpdate(saved);
      setBriefDraft((current) => ({ ...current, brief: refreshed.brief }));
      setBriefSaveStatus("saved");
      setTraceLabel("产品图片设置已更新，请重新确认产品");
    } catch (productError) {
      setError(productError instanceof Error ? productError.message : "产品图片更新失败，请重试。");
    } finally {
      setAnchorBusyTarget(null);
    }
  }

  async function setCurrentVisualAnchor(kind: VisualAnchorCandidateKind, targetId: string, candidateId: string) {
    const candidate = activeProject.visualAnchorWorkspace?.[kind === "character" ? "characterCandidates" : "sceneCandidates"]
      .find((item) => item.id === candidateId && item.targetId === targetId);
    if (!candidate) return;
    try {
      await postAnchorAction({ action: "set-current", kind, targetId, candidateId }, `select:${kind}:${targetId}`);
      setTraceLabel(`${kind === "character" ? "人物" : "场景"}候选方案已设为当前方案`);
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "候选选择失败。");
    }
  }

  async function lockVisualMaster(kind: "product" | VisualAnchorCandidateKind, targetId?: string) {
    if (kind !== "product" && targetId) {
      const selection = getVisualAnchorSelection(activeProject, kind, targetId);
      const candidate = activeProject.visualAnchorWorkspace?.[kind === "character" ? "characterCandidates" : "sceneCandidates"]
        .find((item) => item.id === selection?.selectedCandidateId);
      const spec = kind === "character" ? activeProject.characterVisualSpecs?.find((item) => item.id === targetId)
        : activeProject.sceneVisualSpecs?.find((item) => item.id === targetId);
      if (!candidate) {
        setError(`请先选择一个${kind === "character" ? "人物" : "场景"}候选，再确认使用。`);
        return;
      }
      if (selection?.status === "confirmed" && selection.confirmedCandidateId === selection.selectedCandidateId) {
        setError(`${kind === "character" ? "主角" : "场景"}已经确认；可以先选择其他候选再更换。`);
        return;
      }
      if (spec?.locked && currentMasterAssetId(spec) !== candidate.assetId) {
        try {
          const resourceId = getVisualAnchorResourceId(kind, targetId);
          const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/workflow?resourceId=${encodeURIComponent(resourceId)}`, { cache: "no-store" });
          const result = await readClientApiResponse<{ impact: DependencyImpact }>(response);
          if (!response.ok || !result.success || !result.data?.impact) throw new Error("无法计算视觉基准修改影响。");
          const label = kind === "character"
            ? activeProject.characterVisualSpecs?.find((item) => item.id === targetId)?.role ?? targetId
            : activeProject.sceneVisualSpecs?.find((item) => item.id === targetId)?.name ?? targetId;
          setAnchorVersionIntent({ kind, targetId, candidateId: candidate.id, label, impact: result.data.impact });
        } catch (impactError) {
          setError(impactError instanceof Error ? impactError.message : "无法计算视觉基准修改影响。");
        }
        return;
      }
    }
    try {
      const refreshed = await postAnchorAction({ action: "lock-master", kind, ...(targetId ? { targetId } : {}) }, `lock:${kind}${targetId ? `:${targetId}` : ""}`);
      if (refreshed) {
        const readiness = getVisualAnchorReadiness(refreshed);
        setTraceLabel(readiness.ready ? "全部人物与场景已确认，等待确认当前步骤" : `${kind === "product" ? "产品" : kind === "character" ? "主角" : "场景"}已确认`);
      }
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "视觉基准锁定失败。");
    }
  }

  async function confirmAnchorVersion() {
    if (!anchorVersionIntent) return;
    const intent = anchorVersionIntent;
    try {
      await postAnchorAction({
        action: "lock-master",
        kind: intent.kind,
        targetId: intent.targetId,
        createVersion: true
      }, `version:${intent.kind}:${intent.targetId}`);
      setAnchorVersionIntent(null);
      setTraceLabel(`${intent.label} 已确认并创建 V${intent.impact.nextVersion}`);
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "视觉基准版本创建失败。");
    }
  }

  async function runStoryboardStage() {
    if (isGenerating) return;
    if (!modelStatus?.deepseek.configured) {
      const guidance = "生成文字分镜前需要配置 DeepSeek。";
      setError(guidance);
      openModelSettings("deepseek", guidance);
      return;
    }
    setIsGenerating(true);
    setError(null);
    let storyboardStatusTimer: number | undefined;
    try {
      await postWorkflowAction({ action: "set-stage-status", stageId: "storyboard", status: "running" });
      storyboardStatusTimer = window.setInterval(() => {
        void fetchServerProject(activeProject.id).then((snapshot) => {
          if (["running", "repairing", "failed"].includes(snapshot.project.stageStates?.storyboard.status ?? "")) applyProjectUpdate(snapshot);
        }).catch(() => undefined);
      }, 1_000);
      const response = await postApi<{ shots: StoryboardShot[] }>("/api/generate-storyboard", { projectId: activeProject.id, brief: activeProject.brief, strategy: activeProject.strategy });
      if (!response.success || !response.data?.shots) throw new Error(response.error || "文字分镜生成失败。");
      const snapshot = await fetchServerProject(activeProject.id);
      applyProjectUpdate(snapshot);
      await postWorkflowAction({ action: "set-stage-status", stageId: "storyboard", status: "ready" }, snapshot.version);
      setGenerated(true);
      setTraceLabel("文字分镜已就绪，等待用户确认");
      selectStage("storyboard");
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "文字分镜生成失败。");
      setTraceLabel("文字分镜生成失败");
      try {
        const snapshot = await fetchServerProject(activeProject.id);
        const refreshed = applyProjectUpdate(snapshot);
        if (refreshed.stageStates?.storyboard.status !== "failed") {
          await postWorkflowAction({ action: "set-stage-status", stageId: "storyboard", status: "failed", errorCode: "MODEL_SCHEMA_DRIFT" }, snapshot.version);
        }
      } catch {
        // The generation route normally persists the failed state; keep the visible error if refresh is unavailable.
      }
    } finally {
      if (storyboardStatusTimer !== undefined) window.clearInterval(storyboardStatusTimer);
      setIsGenerating(false);
      await refreshServerEvents(activeProject.id);
    }
  }

  async function generateCurrentShotKeyframes(shotId: string, frameId?: string) {
    if (keyframeBusyShotId) return;
    if (activeProject.stageStates?.anchors.status !== "locked") {
      setKeyframeError("请先完成人物与场景确认。");
      return;
    }
    if (activeProject.stageStates?.storyboard.status !== "locked") {
      setKeyframeError("请先确认文字分镜。");
      return;
    }
    const shot = activeProject.shots.find((item) => item.id === shotId);
    if (!shot) return;
    if (frameId && shot.frames?.find((frame) => frame.id === frameId)?.isLocked) {
      setKeyframeError("这张关键帧已确认。请先取消确认，再生成新版本；旧图片仍保留在私有资产中。");
      return;
    }
    setKeyframeBusyShotId(shotId);
    setKeyframeError(null);
    try {
      await generateProjectKeyframes({
        projectId: activeProject.id,
        shots: [shot],
        aspectRatio: activeProject.brief.aspectRatio,
        ...(frameId ? { frameIds: [frameId] } : {}),
        onProgress: async () => {
          const snapshot = await fetchServerProject(activeProject.id);
          applyProjectUpdate(snapshot);
        }
      });
      applyProjectUpdate(await fetchServerProject(activeProject.id));
    } catch (generationError) {
      setKeyframeError(generationError instanceof Error ? generationError.message : "关键帧生成失败，请稍后重试。");
      try { applyProjectUpdate(await fetchServerProject(activeProject.id)); } catch { /* Keep the last saved snapshot. */ }
    } finally {
      setKeyframeBusyShotId(null);
    }
  }

  async function confirmCurrentFrame(shotId: string, frameId: string, locked: boolean) {
    setKeyframeError(null);
    try {
      await postWorkflowAction({ action: "set-frame-lock", shotId, frameId, locked });
    } catch (confirmationError) {
      setKeyframeError(confirmationError instanceof Error ? confirmationError.message : "关键帧确认失败。");
    }
  }

  const persistedStageStates = activeProject.stageStates!;
  const stageStates: StageStates = briefSaveStatus === "dirty" || briefSaveStatus === "error"
    ? { ...persistedStageStates, brief: { status: "draft", updatedAt: Date.now() } }
    : briefSaveStatus === "saving"
      ? { ...persistedStageStates, brief: { status: "running", updatedAt: Date.now() } }
      : persistedStageStates;
  const activeStageState = stageStates[activeStage];
  const currentPromptPackageIds = new Set((activeProject.shotPromptPackages ?? [])
    .filter((item) => item.schemaVersion === 2 && Boolean(item.inputFingerprint))
    .map((item) => item.shotId));
  const completedPromptPackageCount = activeProject.shots.filter((shot) => currentPromptPackageIds.has(shot.id)).length;
  const promptProgress = deriveShotPromptProgress(activeProject.shots.map((shot) => shot.id), currentPromptPackageIds, activeProject.generationEvents ?? []);
  const storyboardPromptsIncomplete = activeStage === "storyboard"
    && aiStatus.mode === "real"
    && activeStageState.status === "locked"
    && completedPromptPackageCount < activeProject.shots.length;
  const latestStoryboardEvent = [...(activeProject.generationEvents ?? [])].reverse().find((event) => event.stage === "storyboard");
  const visualSetupState = deriveVisualSetupStageState({ ...activeProject, stageStates });
  const stageStatus = activeStage === "anchors" ? visualSetupStatusLabel(visualSetupState.status) : stageStatusLabel(activeStageState.status);
  const shotCountLocked = hasGeneratedStoryboard(activeProject);
  const creativeSet = activeProject.creativeWorkspace?.sets.find((set) => set.id === activeProject.creativeWorkspace?.currentSetId);
  const creativeState = deriveCreativeStageState(activeProject);

  return (
    <main className="workbench-v3">
      <CinematicWorkspaceBackground />
      <WorkspaceHeader active="工作台" workbenchHref={"/generate?projectId=" + activeProject.id} projectHref={"/projects/" + activeProject.id} projectName={activeProject.brief.productName} trailing={<><button type="button" className="workspace-guide-trigger" onClick={() => { setUsageGuideIntro(false); setUsageGuideOpen(true); }}>使用说明</button><Link href={canCreateProject ? "/generate?new=1" : "/projects?notice=project-limit"} className="workspace-new-project">{canCreateProject ? "新建项目" : "管理项目"}</Link><ModelSettingsTrigger status={modelStatus} onClick={() => openModelSettings()} className="workspace-model-settings-trigger" /><AIModeBadge status={aiStatus} /></>} />

      <div className="workbench-v3__page">
        <nav className="workspace-breadcrumb" aria-label="面包屑">
          <Link href="/generate">工作台</Link><span>›</span><span>生成工作台</span><span>›</span><strong>{activeProject.brief.productName}</strong>
        </nav>

        <StageDirectorRail project={activeProject} activeStage={activeStage} states={stageStates} onSelect={selectStage} />

        <section className="workbench-layout stage-gated-layout">
          <StageContextPanel project={previewProject} activeStage={activeStage} onSelect={selectStage} selectedShotId={selectedKeyframeShotId} onShotSelect={setSelectedKeyframeShotId} busyShotId={keyframeBusyShotId} open={contextOpen} onClose={() => setContextOpen(false)} />

          <section className="generation-stage-v3 stage-canvas workspace-column workspace-column--main">
            <div className="generation-stage-v3__glow" aria-hidden="true" />
            <header className="generation-stage-v3__head">
              <div>
                <div className="generation-title-row">
                  <h1>{activeStage === "anchors" ? "人物与场景" : STAGE_LABELS[activeStage]}</h1>
                  <span className={activeStageState.status === "locked" || activeStageState.status === "ready" || (activeStage === "anchors" && visualSetupState.status === "ready-to-complete") ? "is-success" : activeStageState.status === "blocked" ? "is-warning" : ""}><i />{activeStage === "creative" ? creativeStageStatusLabel(creativeState.status) : stageStatus}</span>
                </div>
                <p className="stage-canvas-summary">{stageCanvasSummary(activeStage)}</p>
              </div>
              <div className="generation-stage-v3__actions">
                {(["keyframes", "video", "final"] as StageId[]).includes(activeStage) ? <Link href={"/projects/" + activeProject.id} className="button-secondary-v3">进入素材工作区</Link> : null}
                <button type="button" className="stage-sheet-trigger stage-context-trigger" onClick={() => setContextOpen(true)}>项目导航</button>
                <button type="button" className="stage-sheet-trigger stage-inspector-trigger" onClick={() => setInspectorOpen(true)}>查看状态</button>
              </div>
            </header>

            {activeStage === "brief" ? <section className="stage-brief-editor">
              <div className="stage-canvas-section-head"><div><span>商品信息</span><h2>{briefDraft.brief.productName || "未命名商品"}</h2></div><details className="stage-more-actions"><summary>更多操作</summary><button type="button" onClick={resetBriefToTemplate} disabled={isGenerating}>恢复模板</button></details></div>
              <EditableBriefForm
                brief={briefDraft.brief}
                shotCount={briefDraft.shotCount}
                targetDurationSec={briefDraft.targetDurationSec}
                shotCountSaving={shotCountSaving}
                shotCountLocked={shotCountLocked}
                disabled={isGenerating}
                onChange={updateBrief}
                onShotCountChange={updateShotCount}
                onTargetDurationChange={updateTargetDuration}
                onRequestShotCountChange={requestGeneratedShotCountChange}
              />
              <ProductImageUploader projectId={activeProject.id} images={briefDraft.brief.productImages ?? []} disabled={isGenerating} onChange={(images) => updateBrief({ productImages: images, ...buildProductAssetCollection(images) })} onPersistedVersion={(version) => void refreshProductStateAfterUpload(version)} />
              <footer className="stage-brief-savebar">
                <div><span className={`brief-save-state is-${briefSaveStatus}`}>{briefSaveStatusLabel(briefSaveStatus, activeProject.briefSavedAt)}</span>{briefNotice ? <small>{briefNotice}</small> : null}</div>
                <button type="button" className="button-primary-v3" onClick={() => void saveBriefAndGenerateCreative()} disabled={briefSaveStatus === "saving" || isGenerating}>{isGenerating || briefSaveStatus === "saving" ? "处理中…" : briefSaveStatus === "saved" ? "生成创意方向" : "保存并生成创意"}</button>
              </footer>
            </section> : null}

            {activeStage === "creative" && activeStageState.status !== "blocked" ? <section className="stage-creative-canvas"><CreativeCandidateGrid candidateSet={creativeSet} operation={creativeOperation} stageStatus={creativeState.status} onGenerate={() => void runCreativeStage()} onSelect={(candidateId) => void selectCreativeCandidate(candidateId)} onConfirm={(candidateId) => void confirmCreativeCandidate(candidateId)} /></section> : null}

            {activeStage === "anchors" && activeStageState.status !== "blocked" ? <VisualAnchorsCanvas
              project={activeProject}
              busyTarget={anchorBusyTarget}
              onInitialize={() => void initializeVisualAnchors()}
              onGenerateAll={() => void generateAllVisualCandidates()}
              onConfirmProduct={() => void lockVisualMaster("product")}
              onSetMainProduct={(imageId) => void updateAnchorProductImages(setMainProductImage(activeProject.brief.productImages ?? [], imageId))}
              onRemoveProductReference={(imageId) => void updateAnchorProductImages(removeProductImage(activeProject.brief.productImages ?? [], imageId))}
              onGenerateCandidates={(kind, targetId, candidateIndex) => void generateVisualAnchorCandidates(kind, targetId, candidateIndex)}
              onSetCurrent={(kind, targetId, candidateId) => void setCurrentVisualAnchor(kind, targetId, candidateId)}
              onConfirmTarget={(kind, targetId) => void lockVisualMaster(kind, targetId)}
              onConfirmSelection={() => void confirmVisualSelection()}
              onEnterStoryboard={() => selectStage("storyboard")}
            /> : null}

            {activeStage === "storyboard" && activeStageState.status !== "blocked" ? activeStageState.status === "running" ? <div className="storyboard-loading"><strong>正在生成文字分镜</strong><span>系统会严格按 {activeProject.planningConstraints?.shotCount ?? activeProject.shots.length} 个镜头和 {activeProject.planningConstraints?.targetDurationSec ?? activeProject.brief.durationSec} 秒完成。</span></div> : activeStageState.status === "repairing" ? <div className="storyboard-loading"><strong>正在校正文字分镜结构…</strong><span>系统只整理数据结构，不会缩短或重写已经生成的创意内容。</span></div> : activeStageState.status === "failed" ? <div className="creative-empty-state"><strong>文字分镜生成失败</strong><p>{latestStoryboardEvent?.progressCurrent ? `已完成 ${latestStoryboardEvent.progressCurrent} / ${latestStoryboardEvent.progressTotal ?? activeProject.shots.length} 镜头，成功内容已经保留。` : "文字分镜的数据结构不完整，系统未保存错误结果。"}</p><button type="button" className="button-secondary-v3" disabled={isGenerating} onClick={() => void runStoryboardStage()}>{latestStoryboardEvent?.progressCurrent ? "继续生成剩余镜头" : "重新生成文字分镜"}</button></div> : ["ready", "locked", "outdated"].includes(activeStageState.status) ? <StoryboardTimeline project={activeProject} /> : <div className="creative-empty-state"><strong>文字分镜尚未生成</strong><p>确认人物与场景后，系统会按广告需求中的镜头数量和目标时长生成。</p></div> : null}

            {storyboardPromptsIncomplete ? <section className="shot-prompt-status" aria-label="详细提示词任务状态">
              <header><div><strong>详细提示词</strong><p>已完成 {promptProgress.completed} / {activeProject.shots.length} 镜；{promptProgress.failed} 个失败，{promptProgress.notStarted} 个未开始。此处是 DeepSeek 提示词准备，不是 Qwen 图片生成；成功内容已保存。</p></div><div className="shot-prompt-status__actions"><CallLogDrawer projectId={activeProject.id} projectName={activeProject.brief.productName} label="查看提示词日志" focusStage="prompts" /><button type="button" className="button-secondary-v3" disabled={stageLocking} onClick={() => void retryStoryboardPromptExpansion()}>{stageLocking ? "正在生成…" : "继续生成"}</button></div></header>
              <div className="shot-prompt-status__list">{activeProject.shots.map((shot) => {
                const status = promptProgress.shots.find((item) => item.shotId === shot.id)?.status ?? "not-started";
                const label = ({ "not-started": "未开始", queued: "排队中", generating: "生成中", checking: "校验中", completed: "已完成", failed: "失败", outdated: "需要更新" } as const)[status];
                return <div className="shot-prompt-status__row" key={shot.id}><span>镜头 {String(shot.index).padStart(2, "0")}</span><span className={status === "failed" ? "is-error" : ""}>{label}</span><span>{status === "completed" ? "图片与视频提示词已保存" : status === "failed" ? "详细提示词失败；可单独重试" : "等待生成"}</span><span className="shot-prompt-status__row-actions">{status === "failed" ? <CallLogDrawer projectId={activeProject.id} projectName={activeProject.brief.productName} label="日志" focusShotId={shot.id} focusStage="prompts" /> : null}{status !== "completed" ? <button type="button" disabled={stageLocking} onClick={() => void retryStoryboardPromptExpansion(shot.id)}>{status === "failed" ? "重试" : "生成"}</button> : null}</span></div>;
              })}</div>
            </section> : null}

            {activeStage === "keyframes" && activeStageState.status !== "blocked" ? <KeyframeStageWorkspace project={previewProject} selectedShotId={selectedKeyframeShotId} keyframes={liveKeyframes} busyShotId={keyframeBusyShotId} error={keyframeError} onGenerate={(shotId, frameId) => void generateCurrentShotKeyframes(shotId, frameId)} onConfirm={(shotId, frameId, locked) => void confirmCurrentFrame(shotId, frameId, locked)} /> : null}
            {activeStage === "video" ? <><div className="generation-call-picker-v3"><CallToggle active={selection.wan} title="Wan 2.7 视频" desc="只生成当前镜头，不自动批量运行" onClick={() => toggleSelection("wan")} disabled={isGenerating} /></div><section className="stage-readiness-grid"><StageReadiness label="已确认关键帧" value={`${activeProject.shots.filter((shot) => shot.frames?.every((frame) => frame.isLocked)).length} / ${activeProject.shots.length}`} /><StageReadiness label="镜头视频" value={activeProject.heroVideo ? "1 个已存在" : "等待逐镜头生成"} /><StageReadiness label="旁白" value={activeProject.narrationPlan ? `${activeProject.narrationPlan.beats.length} 条计划` : "尚未计划"} /></section></> : null}
            {activeStage === "final" ? <section className="stage-readiness-grid"><StageReadiness label="关键帧" value={`${liveKeyframes.filter((item) => item.status === "ready").length} 个已完成`} /><StageReadiness label="视频" value={activeProject.heroVideo ? "已完成" : "未完成"} /><StageReadiness label="旁白" value={activeProject.narrationAssetId ? "已完成" : "待生成"} /><StageReadiness label="成片时长" value={`${getProjectDurationSec(activeProject)} 秒`} /><Link href={`/projects/${activeProject.id}#final`} className="button-primary-v3">进入最终成片检查</Link></section> : null}

            {activeStageState.status === "blocked" ? <div className="stage-canvas-blocked"><strong>当前阶段尚未解锁</strong><p>先完成并锁定上一阶段。系统不会自动启动下一项昂贵生成。</p></div> : null}
            {error ? <div className="inline-generation-error">{error}</div> : null}
          </section>

          <StageInspector project={{ ...activeProject, stageStates }} activeStage={activeStage} state={activeStageState} busy={stageLocking} selectedShotId={selectedKeyframeShotId} busyShotId={keyframeBusyShotId} canConfirm={!(["brief", "creative", "anchors"] as StageId[]).includes(activeStage)} onLock={() => void lockCurrentStage()} onOpenModels={() => openModelSettings()} open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
        </section>
      </div>
      <ModelSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} status={modelStatus} onStatusChange={setModelStatus} initialProvider={settingsProvider} guidance={settingsGuidance} />
      <UsageGuideSheet open={usageGuideOpen} introductory={usageGuideIntro} onClose={() => setUsageGuideOpen(false)} />
      {shotCountDialogOpen ? (
        <div className="shot-count-dialog-v4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !shotCountSaving) setShotCountDialogOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="generate-shot-count-dialog-title">
            <header>
              <div><small>调整分镜数量</small><h2 id="generate-shot-count-dialog-title">重新生成完整分镜</h2></div>
              <button type="button" aria-label="关闭" disabled={shotCountSaving} onClick={() => setShotCountDialogOpen(false)}>×</button>
            </header>
            <div className="shot-count-dialog-v4__summary"><span>当前分镜</span><strong>{getEffectiveShotCount(activeProject)} 个</strong></div>
            <ShotCountDialogControl value={requestedShotCount} disabled={shotCountSaving} onChange={setRequestedShotCount} />
            <p>调整后将重新生成完整分镜，现有关键帧、导入广告视频和最终成片会失效。广告需求与核心策略保持不变。</p>
            {shotCountSaving ? <p className="shot-count-dialog-v4__progress" aria-live="polite">正在请求 DeepSeek；20 秒未响应时会自动使用当前数量与时长的本地分镜继续。已等待 {shotCountElapsedSec} 秒。</p> : null}
            <footer>
              <button type="button" className="button-secondary-v3" disabled={shotCountSaving} onClick={() => setShotCountDialogOpen(false)}>取消</button>
              <button type="button" className="button-primary-v3" disabled={shotCountSaving || requestedShotCount === getEffectiveShotCount(activeProject)} onClick={() => void regenerateShotCount()}>{shotCountSaving ? `重新生成中 · ${shotCountElapsedSec} 秒` : "确认并重新生成"}</button>
            </footer>
          </section>
        </div>
      ) : null}
      {briefVersionImpact ? (
        <div className="stage-impact-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && briefSaveStatus !== "saving") setBriefVersionImpact(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="brief-version-dialog-title">
            <header><div><small>修改影响</small><h2 id="brief-version-dialog-title">保存新的商品信息</h2></div><button type="button" aria-label="关闭" disabled={briefSaveStatus === "saving"} onClick={() => setBriefVersionImpact(null)}>×</button></header>
            <p>已经确认的内容不会被覆盖，旧内容会保留，受影响的后续结果会显示为需要更新。</p>
            <div className="stage-impact-summary">
              <div><span>影响阶段</span><strong>{briefVersionImpact.affectedStages.length ? briefVersionImpact.affectedStages.map((stageId) => STAGE_LABELS[stageId]).join("、") : "无"}</strong></div>
              <div><span>影响镜头</span><strong>{briefVersionImpact.affectedShotIds.length} 个</strong></div>
              <div><span>影响帧 / 视频</span><strong>{briefVersionImpact.affectedFrameIds.length} / {briefVersionImpact.affectedVideoIds.length}</strong></div>
              <div><span>最终成片</span><strong>{briefVersionImpact.finalAffected ? "将标记过期" : "不受影响"}</strong></div>
            </div>
            <small>不会自动删除素材，也不会自动重新生成全部内容。</small>
            <footer><button type="button" className="button-secondary-v3" disabled={briefSaveStatus === "saving"} onClick={() => setBriefVersionImpact(null)}>取消</button><button type="button" className="button-primary-v3" disabled={briefSaveStatus === "saving"} onClick={() => void saveBrief(true)}>{briefSaveStatus === "saving" ? "保存中" : "确认保存修改"}</button></footer>
          </section>
        </div>
      ) : null}
      {anchorVersionIntent ? (
        <div className="stage-impact-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !anchorBusyTarget) setAnchorVersionIntent(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="anchor-version-dialog-title">
            <header><div><small>修改影响</small><h2 id="anchor-version-dialog-title">更换已确认的{anchorVersionIntent.label}</h2></div><button type="button" aria-label="关闭" disabled={Boolean(anchorBusyTarget)} onClick={() => setAnchorVersionIntent(null)}>×</button></header>
            <p>原先确认的视觉内容会保留，只有真正使用它的后续素材会显示为需要更新。</p>
            <div className="stage-impact-summary">
              <div><span>影响阶段</span><strong>{anchorVersionIntent.impact.affectedStages.length ? anchorVersionIntent.impact.affectedStages.map((stageId) => STAGE_LABELS[stageId]).join("、") : "无"}</strong></div>
              <div><span>影响镜头</span><strong>{anchorVersionIntent.impact.affectedShotIds.length} 个</strong></div>
              <div><span>影响帧 / 视频</span><strong>{anchorVersionIntent.impact.affectedFrameIds.length} / {anchorVersionIntent.impact.affectedVideoIds.length}</strong></div>
              <div><span>最终成片</span><strong>{anchorVersionIntent.impact.finalAffected ? "将标记过期" : "不受影响"}</strong></div>
            </div>
            <small>不会删除旧候选、关键帧或视频，也不会自动全部重跑。</small>
            <footer><button type="button" className="button-secondary-v3" disabled={Boolean(anchorBusyTarget)} onClick={() => setAnchorVersionIntent(null)}>取消</button><button type="button" className="button-primary-v3" disabled={Boolean(anchorBusyTarget)} onClick={() => void confirmAnchorVersion()}>{anchorBusyTarget ? "保存中" : "确认更换"}</button></footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function parseStageId(value: string | null): StageId {
  return STAGE_ORDER.includes(value as StageId) ? value as StageId : "brief";
}

function stageUrl(projectId: string, stageId: StageId): string {
  return `/generate?projectId=${encodeURIComponent(projectId)}&stage=${stageId}`;
}

function stageCanvasSummary(stageId: StageId): string {
  return ({
    brief: "填写商品事实、真实产品图、目标受众和制作范围。",
    creative: "三套可选择的广告机制、故事走向和产品高光。",
    anchors: "确认广告中的产品、主角和主要场景，后续图片和视频都会优先保持这些设定。",
    storyboard: "镜头内容、节奏、动作和旁白安排。",
    keyframes: "每个镜头的独立关键画面。",
    video: "镜头运动、视频与旁白素材。",
    final: "成片内容、字幕和时间轴检查。"
  } as const)[stageId];
}

function StageReadiness({ label, value }: { label: string; value: string }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function ModelConfigurationCard({ status }: { status: import("@/components/ModelSettingsSheet").ModelSettingsStatus | null }) {
  const rows = [
    { name: "DeepSeek", detail: status?.deepseek.configured ? "已配置" : "未配置", ready: Boolean(status?.deepseek.configured) },
    { name: "Qwen-Image", detail: status?.qwenImage.configured ? "已配置" : "未配置", ready: Boolean(status?.qwenImage.configured) },
    { name: "Wan 2.7", detail: status?.wan.apiAvailable ? "已启用" : "未就绪", ready: Boolean(status?.wan.apiAvailable) },
    { name: "Remotion", detail: "本地未启用", ready: false, title: "Remotion 本地合成功能尚未启用。" }
  ];
  return (
    <section className="model-configuration-card">
      <header><span>模型配置</span></header>
      <div className="model-config-list">{rows.map((row) => <p className="model-config-row" key={row.name}><span className="model-config-provider"><i className={row.ready ? "is-ready" : ""} /><strong>{row.name}</strong></span><span className="model-config-status" title={"title" in row ? row.title : undefined}>{row.detail}</span></p>)}</div>
    </section>
  );
}

function TraceLogLine({ item }: { item: string }) {
  const parts = item.split("｜").filter(Boolean);
  const [lead, ...rest] = parts.length ? parts : [item];

  return (
    <p className="trace-log-line-v3">
      <strong>{lead}</strong>
      {rest.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </p>
  );
}
function StatusSummary({ title, value, detail, tone = "default" }: { title: string; value: string; detail?: string; tone?: "default" | "success" | "blue" }) {
  return <section className={"status-card-v3 is-" + tone}><span>{title}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</section>;
}

function TraceNode({ name, task, active, tone, last = false }: { name: string; task: string; active: boolean; tone: string; last?: boolean }) {
  return <div className={"trace-node-v3 is-" + tone + (active ? " is-active" : "") + (last ? " is-last" : "")}><span className="trace-node-v3__dot" /><div className="trace-content-v3"><div className="trace-main-row-v3"><strong>{name}</strong><em>{active ? "已就绪" : "待执行"}</em></div><small>{task}</small></div></div>;
}



async function postApi<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return readClientApiResponse<T>(response);
}

async function pollWanVideoUntilComplete(
  projectId: string,
  eventId: string,
  onProgress: (elapsedSeconds: number) => void
): Promise<WanVideoData> {
  const intervalMs = 5_000;
  const maxAttempts = 120;
  let consecutiveTransportErrors = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await delay(intervalMs);
    onProgress(Math.round((attempt * intervalMs) / 1_000));

    let response: Response;
    try {
      response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/wan-video?eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store" }
      );
    } catch (error) {
      consecutiveTransportErrors += 1;
      if (consecutiveTransportErrors < 8) continue;
      throw error;
    }

    const result = await readClientApiResponse<WanVideoData>(response);
    if (result.success && result.data?.asset) return result.data;
    if (result.success && (result.data?.status === "running" || result.data?.status === "qa-review")) {
      consecutiveTransportErrors = 0;
      continue;
    }

    const retryable = [502, 503, 504].includes(response.status) || result.data?.status === "running" || result.data?.status === "qa-review";
    if (retryable && consecutiveTransportErrors < 8) {
      consecutiveTransportErrors += 1;
      continue;
    }
    throw new Error(result.error || "Wan 2.7 任务状态查询失败。");
  }

  throw new Error("Wan 2.7 已等待 10 分钟仍未完成。任务可能仍在百炼处理中，请稍后重试。");
}

async function pollQwenImagesUntilComplete(
  projectId: string,
  eventId: string,
  onProgress: (elapsedSeconds: number, completed: number, total: number) => void
): Promise<GenerateImagesData> {
  const intervalMs = 3_000;
  const maxAttempts = 720;
  let consecutiveTransportErrors = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await delay(intervalMs);
    let response: Response;
    try {
      response = await fetch(
        `/api/generate-images?projectId=${encodeURIComponent(projectId)}&eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store" }
      );
    } catch (error) {
      consecutiveTransportErrors += 1;
      if (consecutiveTransportErrors < 12) continue;
      throw error;
    }

    const result = await readClientApiResponse<GenerateImagesData>(response);
    const completed = result.data?.generatedShots ?? 0;
    const total = result.data?.requestedShots ?? 1;
    onProgress(Math.round((attempt * intervalMs) / 1_000), completed, total);
    if (result.success && result.data?.status === "completed") return result.data;
    if (result.success && result.data?.status === "running") {
      consecutiveTransportErrors = 0;
      continue;
    }
    if ([502, 503, 504].includes(response.status) && consecutiveTransportErrors < 12) {
      consecutiveTransportErrors += 1;
      continue;
    }
    throw new Error(result.error || "Qwen-Image 关键帧任务状态查询失败。");
  }

  throw new Error("Qwen-Image 已等待 15 分钟仍未完成。日志会保留具体任务状态，请稍后重试。");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function CallToggle({ active, badge, title, desc, onClick, disabled, muted = false }: { active: boolean; badge?: string; title: string; desc: string; onClick: () => void; disabled: boolean; muted?: boolean }) {
  return (
    <button type="button" className={`ad-call-toggle ${active ? "is-active" : ""} ${muted ? "is-muted" : ""}`} onClick={onClick} disabled={disabled}>
      <span>{badge ?? (active ? "已选择" : "可选择")}</span>
      <strong>{title}</strong>
      <small>{desc}</small>
    </button>
  );
}

function EditableBriefForm({ brief, shotCount, targetDurationSec, shotCountSaving, shotCountLocked, disabled, onChange, onShotCountChange, onTargetDurationChange, onRequestShotCountChange }: {
  brief: ProductBrief;
  shotCount: number;
  targetDurationSec: number;
  shotCountSaving: boolean;
  shotCountLocked: boolean;
  disabled: boolean;
  onChange: (patch: Partial<ProductBrief>) => void;
  onShotCountChange: (value: number) => void;
  onTargetDurationChange: (value: number) => void;
  onRequestShotCountChange: () => void;
}) {
  return (
    <div className="ad-brief-form">
      <section className="form-section">
        <header className="form-section__header"><h3>基础信息</h3></header>
        <div className="form-section__fields">
          <BriefInput label="商品名称" value={brief.productName} disabled={disabled} onChange={(value) => onChange({ productName: value })} />
          <BriefInput label="品类" value={brief.category} disabled={disabled} onChange={(value) => onChange({ category: value })} />
          <BriefInput label="目标用户" value={brief.targetAudience} disabled={disabled} onChange={(value) => onChange({ targetAudience: value })} />
        </div>
      </section>

      <section className="form-section">
        <header className="form-section__header"><h3>广告设置</h3></header>
        <div className="form-section__fields">
          <div className="ad-brief-form-grid">
            <label className="ad-brief-aspect-field"><span>画幅</span><select value={brief.aspectRatio} disabled={disabled} onChange={(event) => onChange({ aspectRatio: event.target.value as AspectRatio })}><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="16:9">16:9</option></select></label>
            {shotCountLocked ? (
              <div className="shot-count-field">
                <span>分镜数量</span>
                <button type="button" className="shot-count-adjust-trigger" disabled={disabled || shotCountSaving} onClick={onRequestShotCountChange}>
                  <strong>{shotCount} 个</strong><span>{shotCountSaving ? "处理中" : "调整"}</span>
                </button>
              </div>
            ) : (
              <ShotCountControl value={shotCount} disabled={disabled || shotCountSaving} saving={shotCountSaving} onCommit={onShotCountChange} />
            )}
            <TargetDurationControl shotCount={shotCount} value={targetDurationSec} disabled={disabled || shotCountSaving} onCommit={onTargetDurationChange} />
          </div>
          <p className="shot-count-help">每个分镜 3–8 秒。当前计划：{shotCount} 个分镜 · 目标 {targetDurationSec} 秒。</p>
          <p className="shot-count-help">可设置总时长：{getAllowedTargetDurationRange(shotCount).min}–{getAllowedTargetDurationRange(shotCount).max} 秒。{shotCountLocked ? "调整分镜数量会重新生成完整分镜。" : ""}</p>
          <BriefTextarea label="风格" value={brief.style} disabled={disabled} rows={3} onChange={(value) => onChange({ style: value })} />
        </div>
      </section>

      <section className="form-section">
        <header className="form-section__header"><h3>产品素材</h3></header>
        <div className="form-section__fields">
          <BriefTextarea label="商品卖点" value={brief.sellingPoints.join("\n")} disabled={disabled} rows={4} onChange={(value) => onChange({ sellingPoints: value.split("\n").map((item) => item.trim()).filter(Boolean) })} />
        </div>
      </section>
    </div>
  );
}

function ShotCountDialogControl({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <div className="shot-count-dialog-v4__control">
      <span>新的分镜数量</span>
      <div>
        <button type="button" aria-label="减少分镜数量" disabled={disabled || value <= MIN_SHOT_COUNT} onClick={() => onChange(clampShotCount(value - 1))}>−</button>
        <input aria-label="新的分镜数量" type="number" min={MIN_SHOT_COUNT} max={MAX_SHOT_COUNT} value={value} disabled={disabled} onChange={(event) => onChange(clampShotCount(Number.parseInt(event.target.value, 10) || value))} />
        <button type="button" aria-label="增加分镜数量" disabled={disabled || value >= MAX_SHOT_COUNT} onClick={() => onChange(clampShotCount(value + 1))}>+</button>
      </div>
      <strong>{MIN_SHOT_COUNT}–{MAX_SHOT_COUNT} 个镜头</strong>
    </div>
  );
}

function ShotCountControl({ value, disabled, saving, onCommit }: { value: number; disabled: boolean; saving: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit(raw: number) {
    const next = clampShotCount(raw);
    setDraft(String(next));
    onCommit(next);
  }

  return (
    <div className="shot-count-field">
      <span>分镜数量</span>
      <div className="shot-count-stepper">
        <button type="button" aria-label="减少分镜数量" disabled={disabled || value <= MIN_SHOT_COUNT} onClick={() => commit(value - 1)}>−</button>
        <input
          aria-label="分镜数量"
          type="number"
          min={MIN_SHOT_COUNT}
          max={MAX_SHOT_COUNT}
          step={1}
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(Number.parseInt(draft, 10) || value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        <button type="button" aria-label="增加分镜数量" disabled={disabled || value >= MAX_SHOT_COUNT} onClick={() => commit(value + 1)}>+</button>
      </div>
      {saving ? <small>保存中</small> : null}
    </div>
  );
}

function TargetDurationControl({ shotCount, value, disabled, onCommit }: { shotCount: number; value: number; disabled: boolean; onCommit: (value: number) => void }) {
  const range = getAllowedTargetDurationRange(shotCount);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit(raw: number) {
    const next = clampTargetDuration(shotCount, raw);
    setDraft(String(next));
    onCommit(next);
  }

  return (
    <div className="shot-count-field target-duration-field">
      <span>目标时长</span>
      <div className="shot-count-stepper">
        <button type="button" aria-label="减少目标时长" disabled={disabled || value <= range.min} onClick={() => commit(value - 1)}>−</button>
        <input
          aria-label="目标时长"
          type="number"
          min={range.min}
          max={range.max}
          step={1}
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(Number.parseInt(draft, 10) || value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        <button type="button" aria-label="增加目标时长" disabled={disabled || value >= range.max} onClick={() => commit(value + 1)}>+</button>
      </div>
    </div>
  );
}
function BriefInput({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function BriefTextarea({ label, value, disabled, rows, onChange }: { label: string; value: string; disabled: boolean; rows: number; onChange: (value: string) => void }) {
  return <label><span>{label}</span><textarea value={value} disabled={disabled} rows={rows} onChange={(event) => onChange(event.target.value)} /></label>;
}

function workflowFromProject(project: GenerationProject): WorkflowStepState {
  const source = project.workflowSteps;
  if (!source) return project.status === "draft" ? idleWorkflowSteps : {
    brief: "completed", strategy: "completed", storyboard: "completed",
    keyframes: "pending", heroShot: "pending", render: "pending"
  };
  return {
    brief: normalizeWorkflowStatus(source.brief),
    strategy: normalizeWorkflowStatus(source.strategy),
    storyboard: normalizeWorkflowStatus(source.storyboard),
    keyframes: normalizeWorkflowStatus(source.keyframes),
    heroShot: normalizeWorkflowStatus(source.heroShot),
    render: normalizeWorkflowStatus(source.render)
  };
}

function normalizeWorkflowStatus(status: string): WorkflowStepStatus {
  if (status === "blocked") return "failed";
  if (["idle", "pending", "running", "qa-review", "completed", "needs-review", "failed", "fallback"].includes(status)) {
    return status as WorkflowStepStatus;
  }
  return "pending";
}

function projectKeyframesToImages(project: GenerationProject): GenerateImagesData["images"] {
  return (project.keyframes ?? []).map((frame) => ({
    shotId: frame.shotId,
    frameId: frame.frameId,
    imageUrl: frame.imageUrl,
    localUrl: frame.localUrl,
    requestId: frame.requestId,
    provider: frame.provider ?? "planned",
    model: frame.model ?? "qwen-image",
    latencyMs: frame.latencyMs ?? 0,
    cacheStatus: frame.cacheStatus ?? "not-requested",
    fallbackUsed: frame.fallbackUsed,
    fallbackReason: frame.fallbackReason ?? null,
    status: frame.status === "ready" ? "ready" : frame.status === "needs-review" ? "needs-review" : frame.status === "fallback" ? "fallback" : ["text-qa", "product-qa", "character-qa", "scene-qa", "qa-review"].includes(frame.status) ? "qa-review" : undefined,
    qaResult: project.keyframeQAResults?.filter((item) => item.shotId === frame.shotId).sort((a, b) => b.attempt - a.attempt)[0] ?? null
  }));
}

function imageWorkflowStatus(images: GenerateImagesData["images"]): WorkflowStepStatus {
  if (images.some((image) => image.status === "needs-review")) return "needs-review";
  if (images.some((image) => image.fallbackUsed || image.status === "fallback")) return "fallback";
  return "completed";
}

function briefWorkflowStatus(status: BriefSaveStatus): WorkflowStepStatus {
  if (status === "saving") return "running";
  if (status === "saved") return "completed";
  if (status === "error") return "failed";
  return "pending";
}

function briefSaveStatusLabel(status: BriefSaveStatus, savedAt?: number): string {
  if (status === "saving") return "正在保存广告需求";
  if (status === "dirty") return "有未保存修改";
  if (status === "error") return "保存失败，请重试";
  if (status === "saved") {
    if (!savedAt) return "广告需求已保存";
    return `上次保存 ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return "广告需求待保存";
}

function hasGeneratedStoryboard(project: GenerationProject): boolean {
  const status = project.workflowSteps?.storyboard;
  return status === "completed" || status === "fallback" || status === "running";
}

async function patchServerProject(projectId: string, patch: Record<string, unknown>, expectedVersion?: number): Promise<ProjectPatchData> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patch, ...(expectedVersion ? { expectedVersion } : {}) })
  });
  const payload = await response.json().catch(() => null) as { data?: ProjectPatchData; error?: { message?: string } } | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message || "项目状态保存失败。");
  }
  return payload.data;
}

async function fetchServerProject(projectId: string): Promise<ProjectPatchData> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null) as { data?: ProjectPatchData; error?: { message?: string } } | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message || "项目刷新失败，请重试。");
  }
  return payload.data;
}
function generationEventsToTrace(events: GenerationEvent[] | undefined): string[] {
  const unique = new Map<string, GenerationEvent>();
  for (const event of events ?? []) unique.set(event.id, event);
  return [...unique.values()]
    .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
    .map((event) => {
      const provider = event.provider === "system" ? "系统" : event.provider === "qwen-image" ? "Qwen-Image" : event.provider === "wan" ? "Wan 2.7" : event.provider === "happyhorse" ? "HappyHorse（历史）" : event.provider === "remotion" ? "Remotion" : "DeepSeek";
      const progress = event.progressTotal ? `｜${event.progressCurrent ?? 0} / ${event.progressTotal}` : "";
      const errorCode = event.errorCode ? `｜错误类型 ${friendlyGenerationErrorCode(event.errorCode)}` : "";
      return `${provider}｜${event.action}｜${eventStatusLabel(event.status)}${progress}${errorCode}｜${event.message}`;
    });
}

function friendlyGenerationErrorCode(code: string) {
  return ({
    MODEL_SCHEMA_DRIFT: "模型输出结构不一致",
    MODEL_STATE_CONTINUITY: "镜头状态衔接不一致",
    PROVIDER_REQUEST_FAILED: "模型请求失败",
    TASK_INTERRUPTED: "任务已中断"
  } as Record<string, string>)[code] ?? "生成任务异常";
}

function initialTraceLabel(events: GenerationEvent[] | undefined): string {
  if (!events?.length) return "未调用";
  const latest = [...events].sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id)).at(-1)!;
  if (latest.status === "failed" || latest.status === "interrupted") return "生成失败";
  if (latest.status === "running" || latest.status === "queued") return latest.message.includes("整理") ? "正在整理" : "执行中";
  if (latest.status === "fallback") return "部分回退完成";
  return "服务端日志已恢复";
}

function eventStatusLabel(status: GenerationEvent["status"]): string {
  const labels: Record<GenerationEvent["status"], string> = {
    queued: "排队中", running: "执行中", "qa-review": "一致性检查", "needs-review": "需人工确认", completed: "已完成", failed: "失败", fallback: "已降级",
    cancelled: "已取消", blocked: "已阻塞", interrupted: "已中断"
  };
  return labels[status];
}
