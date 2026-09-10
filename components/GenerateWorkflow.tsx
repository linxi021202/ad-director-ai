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
import { CreativeDirectorFlow } from "@/components/CreativeDirectorFlow";
import { WorkflowFlowRail, idleWorkflowSteps, type WorkflowStepKey, type WorkflowStepState, type WorkflowStepStatus } from "@/components/WorkflowFlowRail";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import { ProductImageUploader } from "@/components/ProductImageUploader";
import { StageContextPanel, StageDirectorRail, StageInspector, stageStatusLabel } from "@/components/StageDirectorRail";
import { VisualAnchorsCanvas } from "@/components/VisualAnchorsCanvas";
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
import { currentMasterAssetId, getVisualAnchorReadiness, getVisualAnchorResourceId } from "@/lib/visual/visualAnchors";
import {
  saveProjectBriefWithConflictRetry,
  type ProjectPatchData
} from "@/lib/projects/clientMutations";
import { clearProjectGenerationEvents } from "@/lib/projects/clientGenerationEvents";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState<ProviderId | undefined>();
  const [settingsGuidance, setSettingsGuidance] = useState<string | null>(null);
  const { status: modelStatus, setStatus: setModelStatus } = useModelSettingsStatus();
  const previewProject = useMemo<GenerationProject>(() => ({
    ...activeProject,
    brief: {
      ...activeProject.brief,
      aspectRatio: briefDraft.brief.aspectRatio
    }
  }), [activeProject, briefDraft.brief.aspectRatio]);

  function trackServerVersion(version: number) {
    activeVersionRef.current = Math.max(activeVersionRef.current, version);
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

  async function saveBrief(createVersion = false) {
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
    } catch (saveError) {
      setBriefSaveStatus("error");
      setError(saveError instanceof Error ? saveError.message : "商品简报保存失败，请重试。");
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
      setTraceLabel(`Qwen-Image 正在生成关键帧（${completed}/${total}，已等待 ${elapsedSeconds} 秒）`);
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
      setError("请先保存商品简报。");
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
                setTraceLabel(`Qwen-Image 正在生成关键帧（${completed}/${total}，已等待 ${elapsedSeconds} 秒）`);
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
          throw new Error("生成 Wan 2.7 I2V 首帧前需要至少一张已保存的真实产品图。请先在商品简报上传产品主图。");
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

  async function lockCurrentStage() {
    if (stageLocking) return;
    setStageLocking(true);
    setError(null);
    try {
      const refreshed = await postWorkflowAction({ action: "lock-stage", stageId: activeStage });
      const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(activeStage) + 1];
      setTraceLabel(`${STAGE_LABELS[activeStage]}已锁定`);
      if (nextStage) selectStage(nextStage);
      else setActiveProject(refreshed);
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : "阶段锁定失败。");
    } finally {
      setStageLocking(false);
    }
  }

  async function runCreativeStage() {
    if (isGenerating) return;
    if (mode === "custom" && !modelStatus?.deepseek.configured) {
      const guidance = "生成创意方向前需要配置 DeepSeek。";
      setError(guidance);
      openModelSettings("deepseek", guidance);
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      await postWorkflowAction({ action: "set-stage-status", stageId: "creative", status: "running" });
      if (mode === "custom") {
        const requestedShotCount = getEffectiveShotCount(activeProject);
        const targetDurationSec = activeProject.targetDurationSec ?? activeProject.brief.durationSec;
        const response = await postApi<{ strategy: AdStrategy }>("/api/generate-strategy", {
          projectId: activeProject.id,
          brief: activeProject.brief,
          requestedShotCount,
          targetDurationSec,
          shotDurationPlan: allocateShotDurations(requestedShotCount, targetDurationSec)
        });
        if (!response.success || !response.data?.strategy) throw new Error(response.error || "创意方向生成失败。");
      }
      const snapshot = await fetchServerProject(activeProject.id);
      applyProjectUpdate(snapshot);
      await postWorkflowAction({ action: "set-stage-status", stageId: "creative", status: "ready" }, snapshot.version);
      setGenerated(true);
      setTraceLabel("创意方向已就绪，等待用户确认");
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "创意方向生成失败。");
    } finally {
      setIsGenerating(false);
      await refreshServerEvents(activeProject.id);
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

  async function generateVisualAnchorCandidates(kind: VisualAnchorCandidateKind, targetId: string) {
    if (!modelStatus?.qwenImage.configured) {
      const guidance = `生成${kind === "character" ? "人物" : "场景"}候选前需要配置 Qwen-Image。`;
      setError(guidance);
      openModelSettings("qwen-image", guidance);
      return;
    }
    try {
      await postAnchorAction({ action: "generate-candidates", kind, targetId, count: 3 }, `generate:${kind}:${targetId}`);
      setTraceLabel(`${kind === "character" ? "人物" : "场景"}候选已生成，等待选择`);
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "视觉候选生成失败。");
    }
  }

  async function setCurrentVisualAnchor(kind: VisualAnchorCandidateKind, targetId: string, candidateId: string) {
    const spec = kind === "character"
      ? activeProject.characterVisualSpecs?.find((item) => item.id === targetId)
      : activeProject.sceneVisualSpecs?.find((item) => item.id === targetId);
    const candidate = activeProject.visualAnchorWorkspace?.[kind === "character" ? "characterCandidates" : "sceneCandidates"]
      .find((item) => item.id === candidateId && item.targetId === targetId);
    if (!candidate) return;
    if (spec?.locked && currentMasterAssetId(spec) !== candidate.assetId) {
      try {
        const resourceId = getVisualAnchorResourceId(kind, targetId);
        const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/workflow?resourceId=${encodeURIComponent(resourceId)}`, { cache: "no-store" });
        const result = await readClientApiResponse<{ impact: DependencyImpact }>(response);
        if (!response.ok || !result.success || !result.data?.impact) throw new Error("无法计算视觉基准修改影响。");
        setAnchorVersionIntent({
          kind,
          targetId,
          candidateId,
          label: kind === "character"
            ? activeProject.characterVisualSpecs?.find((item) => item.id === targetId)?.role ?? targetId
            : activeProject.sceneVisualSpecs?.find((item) => item.id === targetId)?.name ?? targetId,
          impact: result.data.impact
        });
      } catch (impactError) {
        setError(impactError instanceof Error ? impactError.message : "无法计算视觉基准修改影响。");
      }
      return;
    }
    try {
      await postAnchorAction({ action: "set-current", kind, targetId, candidateId }, `select:${kind}:${targetId}`);
      setTraceLabel(`${kind === "character" ? "Character" : "Scene"} Candidate 已设为 Current`);
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "候选选择失败。");
    }
  }

  async function lockVisualMaster(kind: "product" | VisualAnchorCandidateKind, targetId?: string) {
    try {
      const refreshed = await postAnchorAction({ action: "lock-master", kind, ...(targetId ? { targetId } : {}) }, `lock:${kind}${targetId ? `:${targetId}` : ""}`);
      if (refreshed) {
        const readiness = getVisualAnchorReadiness(refreshed);
        setTraceLabel(readiness.ready ? "全部 Visual Masters 已锁定，等待锁定阶段" : `${kind === "product" ? "Product" : kind === "character" ? "Character" : "Scene"} Master 已锁定`);
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
        action: "set-current",
        kind: intent.kind,
        targetId: intent.targetId,
        candidateId: intent.candidateId,
        createVersion: true
      }, `version:${intent.kind}:${intent.targetId}`);
      setAnchorVersionIntent(null);
      setTraceLabel(`${intent.label} 已创建 V${intent.impact.nextVersion}，等待重新锁定`);
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "视觉基准版本创建失败。");
    }
  }

  async function runStoryboardStage() {
    if (isGenerating) return;
    if (mode === "custom" && !modelStatus?.deepseek.configured) {
      const guidance = "生成文字分镜前需要配置 DeepSeek。";
      setError(guidance);
      openModelSettings("deepseek", guidance);
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      await postWorkflowAction({ action: "set-stage-status", stageId: "storyboard", status: "running" });
      if (mode === "custom") {
        const requestedShotCount = getEffectiveShotCount(activeProject);
        const targetDurationSec = activeProject.targetDurationSec ?? activeProject.brief.durationSec;
        const response = await postApi<{ shots: StoryboardShot[] }>("/api/generate-storyboard", {
          projectId: activeProject.id,
          brief: activeProject.brief,
          strategy: activeProject.strategy,
          requestedShotCount,
          targetDurationSec,
          shotDurationPlan: allocateShotDurations(requestedShotCount, targetDurationSec)
        });
        if (!response.success || !response.data?.shots) throw new Error(response.error || "文字分镜生成失败。");
      }
      const snapshot = await fetchServerProject(activeProject.id);
      applyProjectUpdate(snapshot);
      await postWorkflowAction({ action: "set-stage-status", stageId: "storyboard", status: "ready" }, snapshot.version);
      setGenerated(true);
      setTraceLabel("文字分镜已就绪，等待用户确认");
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "文字分镜生成失败。");
    } finally {
      setIsGenerating(false);
      await refreshServerEvents(activeProject.id);
    }
  }

  const persistedStageStates = activeProject.stageStates!;
  const stageStates: StageStates = briefSaveStatus === "dirty" || briefSaveStatus === "error"
    ? { ...persistedStageStates, brief: { status: "draft", updatedAt: Date.now() } }
    : briefSaveStatus === "saving"
      ? { ...persistedStageStates, brief: { status: "running", updatedAt: Date.now() } }
      : persistedStageStates;
  const activeStageState = stageStates[activeStage];
  const stageStatus = stageStatusLabel(activeStageState.status);
  const shotCountLocked = hasGeneratedStoryboard(activeProject);

  return (
    <main className="workbench-v3">
      <CinematicWorkspaceBackground />
      <WorkspaceHeader active="工作台" workbenchHref={"/generate?projectId=" + activeProject.id} projectHref={"/projects/" + activeProject.id} trailing={<><ModelSettingsTrigger status={modelStatus} onClick={() => openModelSettings()} className="workspace-model-settings-trigger" /><AIModeBadge status={aiStatus} /></>} />

      <div className="workbench-v3__page">
        <nav className="workspace-breadcrumb" aria-label="面包屑">
          <Link href="/generate">工作台</Link><span>›</span><span>生成工作台</span><span>›</span><strong>{activeProject.brief.productName}</strong>
        </nav>

        <StageDirectorRail activeStage={activeStage} states={stageStates} onSelect={selectStage} />

        <section className="workbench-layout stage-gated-layout">
          <StageContextPanel project={previewProject} activeStage={activeStage} open={contextOpen} onClose={() => setContextOpen(false)} />

          <section className="generation-stage-v3 stage-canvas">
            <div className="generation-stage-v3__glow" aria-hidden="true" />
            <header className="generation-stage-v3__head">
              <div>
                <span className="workspace-kicker">Stage {String(STAGE_ORDER.indexOf(activeStage) + 1).padStart(2, "0")}</span>
                <div className="generation-title-row">
                  <h1>{STAGE_LABELS[activeStage]}</h1>
                  <span className={activeStageState.status === "locked" || activeStageState.status === "ready" ? "is-success" : activeStageState.status === "blocked" ? "is-warning" : ""}><i />{stageStatus}</span>
                </div>
                <p className="stage-canvas-summary">{stageCanvasSummary(activeStage)}</p>
              </div>
              <div className="generation-stage-v3__actions">
                {activeStage === "creative" && activeStageState.status !== "locked" ? <button type="button" className="button-primary-v3" onClick={() => void runCreativeStage()} disabled={isGenerating || activeStageState.status === "blocked"}>{isGenerating ? "生成中" : "生成创意方向"}</button> : null}
                {activeStage === "storyboard" && activeStageState.status !== "locked" ? <button type="button" className="button-primary-v3" onClick={() => void runStoryboardStage()} disabled={isGenerating || activeStageState.status === "blocked"}>{isGenerating ? "生成中" : "生成文字分镜"}</button> : null}
                {(["keyframes", "video", "final"] as StageId[]).includes(activeStage) ? <Link href={"/projects/" + activeProject.id} className="button-secondary-v3">进入素材工作区</Link> : null}
                <Link
                  href={canCreateProject ? "/generate?new=1" : "/projects?notice=project-limit"}
                  className="button-secondary-v3"
                  title={canCreateProject ? "创建新项目" : "当前会话已达到 3 个项目上限，请先管理已有项目"}
                >
                  {canCreateProject ? "新建项目" : "管理项目"}
                </Link>
                <button type="button" className="stage-sheet-trigger stage-context-trigger" onClick={() => setContextOpen(true)}>阶段导航</button>
                <button type="button" className="stage-sheet-trigger stage-inspector-trigger" onClick={() => setInspectorOpen(true)}>阶段检查器</button>
              </div>
            </header>

            {activeStage === "brief" ? <section className="stage-brief-editor">
              <div className="stage-canvas-section-head"><div><span>完整简报</span><h2>{briefDraft.brief.productName || "未命名商品"}</h2></div><button type="button" className="button-secondary-v3" onClick={resetBriefToTemplate} disabled={isGenerating}>恢复模板</button></div>
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
              <ProductImageUploader projectId={activeProject.id} images={briefDraft.brief.productImages ?? []} disabled={isGenerating} onChange={(images) => updateBrief({ productImages: images })} onPersistedVersion={trackServerVersion} />
              <footer className="stage-brief-savebar">
                <div><span className={`brief-save-state is-${briefSaveStatus}`}>{briefSaveStatusLabel(briefSaveStatus, activeProject.briefSavedAt)}</span>{briefNotice ? <small>{briefNotice}</small> : null}</div>
                <button type="button" className="button-primary-v3" onClick={() => void saveBrief()} disabled={briefSaveStatus === "saving" || briefSaveStatus === "saved" || isGenerating}>{briefSaveStatus === "saving" ? "保存中…" : briefSaveStatus === "saved" ? "已保存" : briefSaveStatus === "error" ? "重新保存商品简报" : "保存商品简报"}</button>
              </footer>
            </section> : null}

            {activeStage === "creative" ? <section className="stage-creative-canvas">
              <div className="generation-mode-v3" aria-label="创意生成方式">
                <button type="button" className={mode === "template" ? "is-active" : ""} onClick={() => setMode("template")} disabled={isGenerating}>使用现有方向</button>
                <button type="button" className={mode === "custom" ? "is-active" : ""} onClick={() => setMode("custom")} disabled={isGenerating}>DeepSeek 生成</button>
              </div>
              <div className="creative-candidate-grid">
                <article className="creative-candidate is-current"><header><span>Candidate 01</span><strong>Current</strong></header><h2>{activeProject.strategy.coreMessage}</h2><p>{activeProject.strategy.bigIdea}</p><dl><div><dt>目标人群</dt><dd>{activeProject.brief.targetAudience}</dd></div><div><dt>视觉风格</dt><dd>{activeProject.brief.style}</dd></div><div><dt>商业结构</dt><dd>Hook → Context → Product → Experience → Payoff → CTA</dd></div></dl></article>
                <article className="creative-candidate is-empty"><span>Candidate 02</span><p>运行 DeepSeek 后保留为独立候选。</p></article>
                <article className="creative-candidate is-empty"><span>Candidate 03</span><p>运行 DeepSeek 后保留为独立候选。</p></article>
              </div>
            </section> : null}

            {activeStage === "anchors" ? <VisualAnchorsCanvas
              project={activeProject}
              busyTarget={anchorBusyTarget}
              onInitialize={() => void initializeVisualAnchors()}
              onGenerateCandidates={(kind, targetId) => void generateVisualAnchorCandidates(kind, targetId)}
              onSetCurrent={(kind, targetId, candidateId) => void setCurrentVisualAnchor(kind, targetId, candidateId)}
              onLockMaster={(kind, targetId) => void lockVisualMaster(kind, targetId)}
            /> : null}

            {activeStage === "storyboard" ? <section className="storyboard-text-timeline" aria-label="文字分镜时间线">
              {activeProject.shots.map((shot) => <article id={`storyboard-shot-${shot.id}`} key={shot.id}><header><strong>Shot {String(shot.index).padStart(2, "0")}</strong><span>{shot.durationSec} 秒</span></header><h2>{shot.narrativeProgression?.newInformation ?? shot.goal}</h2><p>{shot.visualDescription}</p><dl><div><dt>Purpose</dt><dd>{shot.narrativeProgression?.resultingState ?? shot.goal}</dd></div><div><dt>Micro Beats</dt><dd>{shot.microBeats?.length ?? 0}</dd></div><div><dt>Narration</dt><dd>{activeProject.narrationPlan?.beats.find((beat) => beat.shotId === shot.id)?.text ?? "留白"}</dd></div></dl></article>)}
            </section> : null}

            {activeStage === "keyframes" ? <ResultBoard project={previewProject} keyframes={liveKeyframes} callTrace={[]} projectId={activeProject.id} generated={generated} isGenerating={isGenerating} /> : null}
            {activeStage === "video" ? <><div className="generation-call-picker-v3"><CallToggle active={selection.wan} title="Wan 2.7 视频" desc="只生成当前镜头，不自动批量运行" onClick={() => toggleSelection("wan")} disabled={isGenerating} /></div><section className="stage-readiness-grid"><StageReadiness label="已锁定关键帧" value={`${activeProject.shots.filter((shot) => shot.frames?.every((frame) => frame.isLocked)).length} / ${activeProject.shots.length}`} /><StageReadiness label="镜头视频" value={activeProject.heroVideo ? "1 个已存在" : "等待逐镜头生成"} /><StageReadiness label="旁白" value={activeProject.narrationPlan ? `${activeProject.narrationPlan.beats.length} 条计划` : "尚未计划"} /></section></> : null}
            {activeStage === "final" ? <section className="stage-readiness-grid"><StageReadiness label="关键帧" value={`${liveKeyframes.filter((item) => item.status === "ready").length} ready`} /><StageReadiness label="视频" value={activeProject.heroVideo ? "ready" : "未完成"} /><StageReadiness label="旁白" value={activeProject.narrationAssetId ? "ready" : "待生成"} /><StageReadiness label="Timeline" value={`${getProjectDurationSec(activeProject)} 秒`} /><Link href={`/projects/${activeProject.id}#final`} className="button-primary-v3">进入最终成片检查</Link></section> : null}

            {activeStageState.status === "blocked" ? <div className="stage-canvas-blocked"><strong>当前阶段尚未解锁</strong><p>先完成并锁定上一阶段。系统不会自动启动下一项昂贵生成。</p></div> : null}
            {error ? <div className="inline-generation-error">{error}</div> : null}
          </section>

          <StageInspector project={{ ...activeProject, stageStates }} activeStage={activeStage} state={activeStageState} busy={stageLocking} onLock={() => void lockCurrentStage()} onOpenModels={() => openModelSettings()} open={inspectorOpen} onClose={() => setInspectorOpen(false)}>
            <details className="trace-footer-v3"><summary>查看执行日志</summary>{callTrace.length ? callTrace.map((item, index) => <TraceLogLine key={`${index}-${item}`} item={item} />) : <p>当前阶段尚无执行日志。</p>}</details>
            <footer className="status-rail-footer"><button type="button" className="status-rail-settings" onClick={() => openModelSettings()}>管理模型设置</button></footer>
          </StageInspector>
        </section>
      </div>
      <ModelSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} status={modelStatus} onStatusChange={setModelStatus} initialProvider={settingsProvider} guidance={settingsGuidance} />
      {shotCountDialogOpen ? (
        <div className="shot-count-dialog-v4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !shotCountSaving) setShotCountDialogOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="generate-shot-count-dialog-title">
            <header>
              <div><small>调整分镜数量</small><h2 id="generate-shot-count-dialog-title">重新生成完整分镜</h2></div>
              <button type="button" aria-label="关闭" disabled={shotCountSaving} onClick={() => setShotCountDialogOpen(false)}>×</button>
            </header>
            <div className="shot-count-dialog-v4__summary"><span>当前分镜</span><strong>{getEffectiveShotCount(activeProject)} 个</strong></div>
            <ShotCountDialogControl value={requestedShotCount} disabled={shotCountSaving} onChange={setRequestedShotCount} />
            <p>调整后将重新生成完整分镜，现有关键帧、导入广告视频和最终成片会失效。商品简报与核心策略保持不变。</p>
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
            <header><div><small>版本与依赖影响</small><h2 id="brief-version-dialog-title">修改商品简报将创建 V{briefVersionImpact.nextVersion}</h2></div><button type="button" aria-label="关闭" disabled={briefSaveStatus === "saving"} onClick={() => setBriefVersionImpact(null)}>×</button></header>
            <p>Locked 内容不会被覆盖。V{briefVersionImpact.currentVersion} 将继续保留，下游旧结果只会标记为 outdated。</p>
            <div className="stage-impact-summary">
              <div><span>影响阶段</span><strong>{briefVersionImpact.affectedStages.length ? briefVersionImpact.affectedStages.map((stageId) => STAGE_LABELS[stageId]).join("、") : "无"}</strong></div>
              <div><span>影响镜头</span><strong>{briefVersionImpact.affectedShotIds.length} 个</strong></div>
              <div><span>影响帧 / 视频</span><strong>{briefVersionImpact.affectedFrameIds.length} / {briefVersionImpact.affectedVideoIds.length}</strong></div>
              <div><span>最终成片</span><strong>{briefVersionImpact.finalAffected ? "将标记过期" : "不受影响"}</strong></div>
            </div>
            <small>不会自动删除资产，也不会自动重新生成全部内容。</small>
            <footer><button type="button" className="button-secondary-v3" disabled={briefSaveStatus === "saving"} onClick={() => setBriefVersionImpact(null)}>取消</button><button type="button" className="button-primary-v3" disabled={briefSaveStatus === "saving"} onClick={() => void saveBrief(true)}>{briefSaveStatus === "saving" ? "创建中" : `创建商品简报 V${briefVersionImpact.nextVersion}`}</button></footer>
          </section>
        </div>
      ) : null}
      {anchorVersionIntent ? (
        <div className="stage-impact-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !anchorBusyTarget) setAnchorVersionIntent(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="anchor-version-dialog-title">
            <header><div><small>版本与依赖影响</small><h2 id="anchor-version-dialog-title">修改 {anchorVersionIntent.label} 将创建 V{anchorVersionIntent.impact.nextVersion}</h2></div><button type="button" aria-label="关闭" disabled={Boolean(anchorBusyTarget)} onClick={() => setAnchorVersionIntent(null)}>×</button></header>
            <p>Locked Master 不会被覆盖。V{anchorVersionIntent.impact.currentVersion} 将继续保留，只有真正依赖它的下游资产会标记为 outdated。</p>
            <div className="stage-impact-summary">
              <div><span>影响阶段</span><strong>{anchorVersionIntent.impact.affectedStages.length ? anchorVersionIntent.impact.affectedStages.map((stageId) => STAGE_LABELS[stageId]).join("、") : "无"}</strong></div>
              <div><span>影响镜头</span><strong>{anchorVersionIntent.impact.affectedShotIds.length} 个</strong></div>
              <div><span>影响帧 / 视频</span><strong>{anchorVersionIntent.impact.affectedFrameIds.length} / {anchorVersionIntent.impact.affectedVideoIds.length}</strong></div>
              <div><span>最终成片</span><strong>{anchorVersionIntent.impact.finalAffected ? "将标记过期" : "不受影响"}</strong></div>
            </div>
            <small>不会删除旧候选、Master、关键帧或视频，也不会自动全量重跑。</small>
            <footer><button type="button" className="button-secondary-v3" disabled={Boolean(anchorBusyTarget)} onClick={() => setAnchorVersionIntent(null)}>取消</button><button type="button" className="button-primary-v3" disabled={Boolean(anchorBusyTarget)} onClick={() => void confirmAnchorVersion()}>{anchorBusyTarget ? "创建中" : `创建 ${anchorVersionIntent.label} V${anchorVersionIntent.impact.nextVersion}`}</button></footer>
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
    brief: "确认商业事实、产品资产和制作范围。服务器保存成功后再由你锁定。",
    creative: "只确定广告要说什么和如何推进；本阶段不会调用图片或视频模型。",
    anchors: "锁定产品、人物和场景身份，允许状态变化，不允许身份漂移。",
    storyboard: "在低成本阶段确认镜头、节奏、动作和旁白，不生成视觉资产。",
    keyframes: "逐镜头确认多个独立视觉状态；下游只使用已锁定帧。",
    video: "按镜头生成运动和旁白，失败或返工不会波及无关镜头。",
    final: "检查商业可用性、Ending、字幕和时间轴，再批准成片。"
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
  const maxAttempts = 300;
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

function ResultBoard({ project, keyframes, callTrace, projectId, generated, isGenerating }: { project: GenerationProject; keyframes: GenerateImagesData["images"]; callTrace: string[]; projectId: string; generated: boolean; isGenerating: boolean }) {
  return (
    <div className={"creative-result-v3" + (generated ? " is-ready" : "")}>
      <section className="creative-summary-v3">
        <div className="creative-summary-v3__copy">
          <span>{generated ? "核心创意" : isGenerating ? "正在生成策略" : "创意预览"}</span>
          <h2>{project.strategy.coreMessage}</h2>
          <p>{project.strategy.bigIdea}</p>
          <div className="creative-summary-v3__actions">
            <Link href={"/projects/" + projectId} className="button-accent-v3">进入项目精修 <span>→</span></Link>
            <Link href={"/projects/" + projectId} className="text-action-v3">查看项目</Link>
          </div>
        </div>
        <CreativeDirectorFlow />
      </section>

      <section className="storyboard-overview-v3">
        <header><div><strong>镜头概览</strong><span>共 {project.shots.length} 个镜头</span></div><Link href={"/projects/" + projectId}>查看完整分镜脚本</Link></header>
        <div className="storyboard-overview-v3__grid">
          {project.shots.map((shot) => (
            <article key={shot.id} className="storyboard-preview-v3">
              <AdaptiveMediaFrame
                aspectRatio={project.brief.aspectRatio}
                src={shotPreviewUrl(shot, keyframes)}
                mediaType="image"
                fit="contain"
                alt={`镜头 ${shot.index} 预览`}
                stage="overview"
                className="storyboard-preview-v3__media"
                overlay={<><span>镜头 {shot.index}</span><em>{shot.durationSec} 秒</em></>}
              />
              <div><strong>{shot.subtitle}</strong><p>{shot.goal}</p></div>
            </article>
          ))}
        </div>
      </section>

      {callTrace.length > 0 ? <details className="result-log-v3"><summary>查看本次生成日志</summary>{callTrace.map((item, index) => <TraceLogLine key={`${index}-${item}`} item={item} />)}</details> : null}
    </div>
  );
}

function shotPreviewUrl(shot: StoryboardShot, keyframes: GenerateImagesData["images"]) {
  const generated = keyframes.find((image) => image.shotId === shot.id);
  if (generated?.localUrl || generated?.imageUrl) return generated.localUrl || generated.imageUrl!;
  if (shot.index === 2) return "/demo-keyframes/shot-2.png";
  if (shot.index === 3) return "/demo-keyframes/shot-3.png";
  if (shot.index === 4) return "/demo-keyframes/shot-4.png";
  return "/landing-cold-brew-hero.png";
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
  if (status === "saving") return "正在保存商品简报";
  if (status === "dirty") return "有未保存修改";
  if (status === "error") return "保存失败，请重试";
  if (status === "saved") {
    if (!savedAt) return "商品简报已保存";
    return `上次保存 ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return "商品简报待保存";
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
      const errorCode = event.errorCode ? `｜错误码 ${event.errorCode}` : "";
      return `${provider}｜${event.action}｜${eventStatusLabel(event.status)}${progress}${errorCode}｜${event.message}`;
    });
}

function initialTraceLabel(events: GenerationEvent[] | undefined): string {
  if (!events?.length) return "未调用";
  if (events.some((event) => event.status === "running" || event.status === "queued")) return "执行中";
  if (events.some((event) => event.status === "failed" || event.status === "interrupted")) return "部分任务需重试";
  if (events.some((event) => event.status === "fallback")) return "部分回退完成";
  return "服务端日志已恢复";
}

function eventStatusLabel(status: GenerationEvent["status"]): string {
  const labels: Record<GenerationEvent["status"], string> = {
    queued: "排队中", running: "执行中", "qa-review": "一致性检查", "needs-review": "需人工确认", completed: "已完成", failed: "失败", fallback: "已降级",
    cancelled: "已取消", blocked: "已阻塞", interrupted: "已中断"
  };
  return labels[status];
}
