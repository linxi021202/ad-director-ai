"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelSettingsSheet, type ModelSettingsStatus, type ProviderId } from "@/components/ModelSettingsSheet";
import { ModelSettingsTrigger } from "@/components/model-settings/ModelSettingsTrigger";
import { useModelSettingsStatus } from "@/components/model-settings/useModelSettingsStatus";
import { AIModeBadge, type AITraceStatus } from "@/components/AIModeBadge";
import { CinematicWorkspaceBackground } from "@/components/workspace/CinematicWorkspaceBackground";
import { CreativeDirectorFlow } from "@/components/CreativeDirectorFlow";
import { WorkflowFlowRail, idleWorkflowSteps, type WorkflowStepKey, type WorkflowStepState, type WorkflowStepStatus } from "@/components/WorkflowFlowRail";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import { ProductImageUploader } from "@/components/ProductImageUploader";
import { buildOptimizedVideoPrompt, resolveHeroShot } from "@/lib/heroVideo";
import type { AdStrategy, AspectRatio, GenerationEvent, GenerationProject, ProductBrief, StoryboardShot } from "@/lib/schemas/project";
import { normalizeProjectDuration } from "@/lib/projectDuration";
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
type CallSelection = {
  deepseek: boolean;
  qwenImage: boolean;
  happyHorse: boolean;
};

type ProviderDiagnostic = {
  code: string;
  title: string;
  detail: string;
  hint: string;
};

type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  trace?: unknown;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  error?: string;
};

type HappyHorseVideoData = { asset: { publicUrl: string; shotId: string; source: "happyhorse-api" } };

type GenerateImagesData = {
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
    diagnostic?: ProviderDiagnostic | null;
  }>;
  failedShots: Array<{ shotId: string; fallbackReason: string | null; diagnostic?: ProviderDiagnostic | null }>;
};

const chain = ["简报", "策略", "分镜", "关键帧", "主镜头", "合成"];
const routes = ["DeepSeek → 策略 / 分镜 / 提示词", "Qwen-Image → 关键帧", "HappyHorse → 主镜头", "Remotion → 成片合成"];
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
  const failedImages = data.images.filter((image) => image.fallbackUsed);
  if (failedImages.length === 0) {
    return `Qwen-Image｜${data.images.length} 张关键帧完成｜${data.images[0]?.model ?? "qwen-image"}`;
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
  if (selection.happyHorse && !status.happyHorse.apiAvailable) return false;
  return selection.deepseek || selection.qwenImage || selection.happyHorse;
}

export function GenerateWorkflow({ project, projectVersion, aiStatus, canCreateProject }: GenerateWorkflowProps) {
  const router = useRouter();
  const initialProject = normalizeProjectDuration(project);
  const initialShotCount = getEffectiveShotCount(initialProject);
  const initialTargetDurationSec = clampTargetDuration(
    initialShotCount,
    initialProject.targetDurationSec ?? initialProject.brief.durationSec ?? DEFAULT_TARGET_DURATION_SEC
  );
  const [generated, setGenerated] = useState(initialProject.status !== "draft");
  const [activeVersion, setActiveVersion] = useState(projectVersion);
  const [briefDraft, setBriefDraft] = useState<BriefDraft>(() => ({
    brief: { ...initialProject.brief, durationSec: initialTargetDurationSec },
    shotCount: initialShotCount,
    targetDurationSec: initialTargetDurationSec
  }));
  const [briefSaveStatus, setBriefSaveStatus] = useState<BriefSaveStatus>(() => initialProject.briefStatus === "saved" ? "saved" : "draft");
  const [briefNotice, setBriefNotice] = useState<string | null>(null);
  const [shotCountSaving, setShotCountSaving] = useState(false);
  const [shotCountDialogOpen, setShotCountDialogOpen] = useState(false);
  const [requestedShotCount, setRequestedShotCount] = useState(() => initialShotCount);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStepState>(() => workflowFromProject(initialProject));
  const [mode, setMode] = useState<GenerationMode>("template");
  const [selection, setSelection] = useState<CallSelection>({ deepseek: true, qwenImage: true, happyHorse: true });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceLabel, setTraceLabel] = useState(() => initialTraceLabel(initialProject.generationEvents));
  const [callTrace, setCallTrace] = useState<string[]>(() => generationEventsToTrace(initialProject.generationEvents));
  const [activeProject, setActiveProject] = useState<GenerationProject>(initialProject);
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

  function commitWorkflow(next: WorkflowStepState) {
    setWorkflowSteps(next);
    void patchServerProject(activeProject.id, { workflowSteps: next });
  }

  function patchWorkflow(patch: Partial<WorkflowStepState>) {
    setWorkflowSteps((current) => {
      const next = { ...current, ...patch };
      void patchServerProject(activeProject.id, { workflowSteps: next });
      return next;
    });
  }

  function setStep(key: WorkflowStepKey, status: WorkflowStepStatus) { patchWorkflow({ [key]: status }); }

  function handleModeChange(nextMode: GenerationMode) {
    setMode(nextMode);
    setGenerated(false);
    setIsGenerating(false);
    const nextWorkflow = { ...idleWorkflowSteps, brief: briefSaveStatus === "saved" ? "completed" as const : "pending" as const };
    setWorkflowSteps(nextWorkflow);
    if (briefSaveStatus === "saved") void patchServerProject(activeProject.id, { workflowSteps: nextWorkflow });
    setError(null);
  }

  function updateBrief(patch: Partial<ProductBrief>) {
    setGenerated(false);
    setError(null);
    setBriefNotice(null);
    setBriefDraft((current) => ({ ...current, brief: { ...current.brief, ...patch } }));
    setBriefSaveStatus("dirty");
    setWorkflowSteps((current) => ({ ...current, brief: "pending" }));
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
    setWorkflowSteps((current) => ({ ...current, brief: "pending" }));
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
    setWorkflowSteps((current) => ({ ...current, brief: "pending" }));
  }

  async function saveBrief() {
    if (briefSaveStatus === "saving" || isGenerating) return;
    const savedTargetDuration = activeProject.targetDurationSec ?? activeProject.brief.durationSec;
    const targetDurationChanged = briefDraft.targetDurationSec !== savedTargetDuration;
    if (hasGeneratedStoryboard(activeProject) && targetDurationChanged) {
      const confirmed = window.confirm("修改目标时长将重新分配所有镜头的时长，并需要重新生成最终成片。");
      if (!confirmed) return;
    }
    setBriefSaveStatus("saving");
    setError(null);
    try {
      const saved = await saveServerBrief(activeProject.id, activeVersion, briefDraft);
      const refreshed = normalizeProjectDuration(saved.project);
      const savedShotCount = getEffectiveShotCount(refreshed);
      const savedTarget = refreshed.targetDurationSec ?? refreshed.brief.durationSec;
      setActiveVersion(saved.version);
      setActiveProject(refreshed);
      setBriefDraft({
        brief: { ...refreshed.brief, durationSec: savedTarget },
        shotCount: savedShotCount,
        targetDurationSec: savedTarget
      });
      setWorkflowSteps(workflowFromProject(refreshed));
      setBriefSaveStatus("saved");
      setBriefNotice(null);
      router.replace(`/generate?projectId=${encodeURIComponent(refreshed.id)}`);
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
    const shotCount = clampShotCount(requestedShotCount);
    if (shotCount === getEffectiveShotCount(activeProject)) {
      setShotCountDialogOpen(false);
      return;
    }

    setShotCountSaving(true);
    setError(null);
    try {
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
      setActiveVersion(snapshot.version);
      setActiveProject(refreshed);
      setWorkflowSteps(workflowFromProject(refreshed));
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
      setError(saveError instanceof Error ? saveError.message : "分镜数量调整失败，请重试。");
    } finally {
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
    setWorkflowSteps((current) => ({ ...current, brief: "pending" }));
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
    if (selection.happyHorse && !modelStatus?.happyHorse.apiAvailable) return { provider: "qwen-image" as const, guidance: "调用 HappyHorse 前需要配置百炼 API Key，并在服务端启用真实视频生成。" };

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

  useEffect(() => {
    void refreshServerEvents(activeProject.id);
  }, [activeProject.id, refreshServerEvents]);

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
      await patchServerProject(templateProject.id, {
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

    if (!selection.deepseek && !selection.qwenImage && !selection.happyHorse) {
      setError("请至少选择一个真实调用节点，或切回使用模板。");
      commitWorkflow(idleWorkflowSteps);
      return;
    }

    setIsGenerating(true);
    setTraceLabel("真实调用中");

    try {
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
        if (!imageResponse.success || !imageResponse.data?.images) {
          throw new Error(imageResponse.error || "Qwen-Image 关键帧生成失败，请检查百炼配置。");
        }
        generatedImages = imageResponse.data.images;
        patchWorkflow({ keyframes: generatedImages.some((image) => image.fallbackUsed) ? "fallback" : "completed", heroShot: selection.happyHorse ? "running" : "pending" });
        setLiveKeyframes(generatedImages);
      }

      if (selection.happyHorse) {
        const selectedHeroShot = resolveHeroShot(workingProject.shots, workingProject.heroShotId) ?? workingProject.shots[0];
        if (!selectedHeroShot) throw new Error("HappyHorse 调用失败：项目没有可用的主镜头。");
        const heroKeyframe = generatedImages.find((image) => image.shotId === selectedHeroShot.id);
        const heroReferenceUrl = heroKeyframe?.localUrl || heroKeyframe?.imageUrl;
        if (!heroReferenceUrl) {
          throw new Error("HappyHorse 多参考图生成需要当前主镜头关键帧。请先生成当前主镜头关键帧。");
        }
        if (!(workingProject.brief.productImages ?? []).some((image) => image.role !== "logo" && (image.localUrl || image.remoteUrl || image.url))) {
          throw new Error("HappyHorse 多参考图生成需要至少一张已保存的真实产品图。请先在商品简报上传产品主图。");
        }
        setTraceLabel("HappyHorse 主镜头调用中");
        setStep("heroShot", "running");
        const videoResponse = await postApi<HappyHorseVideoData>("/api/projects/" + encodeURIComponent(workingProject.id) + "/happyhorse-video", {
          shotId: selectedHeroShot.id,
          imageUrl: heroReferenceUrl,
          productImages: workingProject.brief.productImages ?? [],
          prompt: buildOptimizedVideoPrompt(selectedHeroShot),
          aspectRatio: workingProject.brief.aspectRatio,
          durationSec: Math.min(MAX_SHOT_DURATION_SEC, Math.max(MIN_SHOT_DURATION_SEC, Math.round(selectedHeroShot.durationSec || DEFAULT_SHOT_DURATION_SEC)))
        });
        if (!videoResponse.success || !videoResponse.data?.asset) {
          throw new Error(videoResponse.error || "HappyHorse 主镜头生成失败，请检查百炼 Key、模型权限和账户状态。");
        }
        setStep("heroShot", "completed");
      }

      setWorkflowSteps((current) => {
        const next: WorkflowStepState = {
          ...current,
          keyframes: selection.qwenImage ? current.keyframes : "fallback",
          heroShot: selection.happyHorse ? current.heroShot : "pending",
          render: "pending"
        };
        void patchServerProject(activeProject.id, { workflowSteps: next, status: "completed" }).catch((saveError) => {
          setError(saveError instanceof Error ? saveError.message : "项目状态保存失败。");
        });
        return next;
      });

      setGenerated(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "真实调用失败。请确认服务端环境变量已配置。不同 Key 不会在前端显示。");
      setTraceLabel("调用失败");
      setWorkflowSteps((current) => {
        const running = (Object.entries(current).find(([, status]) => status === "running")?.[0] ?? "strategy") as WorkflowStepKey;
        const next = { ...current, [running]: "failed" as const };
        void patchServerProject(activeProject.id, { workflowSteps: next, status: "failed" }).catch(() => undefined);
        return next;
      });
    } finally {
      setIsGenerating(false);
      await refreshServerEvents(activeProject.id);
    }
  }

  const stageStatus = generated ? "已就绪" : isGenerating ? "生成中" : "等待生成";
  const shotCountLocked = hasGeneratedStoryboard(activeProject);

  return (
    <main className="workbench-v3">
      <CinematicWorkspaceBackground />
      <WorkspaceHeader active="工作台" workbenchHref={"/generate?projectId=" + activeProject.id} projectHref={"/projects/" + activeProject.id} trailing={<><ModelSettingsTrigger status={modelStatus} onClick={() => openModelSettings()} className="workspace-model-settings-trigger" /><AIModeBadge status={aiStatus} /></>} />

      <div className="workbench-v3__page">
        <nav className="workspace-breadcrumb" aria-label="面包屑">
          <Link href="/generate">工作台</Link><span>›</span><span>生成工作台</span><span>›</span><strong>{activeProject.brief.productName}</strong>
        </nav>

        <section className="workbench-layout">
          <aside className="brief-panel-v3 brief-sidebar-shell">
            <div className="brief-panel-v3__head">
              <div><span>商品简报</span><h2>{briefDraft.brief.productName || "未命名商品"}</h2></div>
              <button type="button" onClick={resetBriefToTemplate} disabled={isGenerating}>恢复模板</button>
            </div>
            <div className="brief-sidebar-content"><EditableBriefForm
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
            <ProductImageUploader projectId={activeProject.id} images={briefDraft.brief.productImages ?? []} disabled={isGenerating} onChange={(images) => updateBrief({ productImages: images })} />
            </div>
            <footer className="brief-sidebar-footer brief-save-footer">
              <span className={`brief-save-state is-${briefSaveStatus}`}>{briefSaveStatusLabel(briefSaveStatus, activeProject.briefSavedAt)}</span>
              {briefNotice ? <small>{briefNotice}</small> : null}
              <button type="button" className="button-primary-v3" onClick={() => void saveBrief()} disabled={briefSaveStatus === "saving" || briefSaveStatus === "saved" || isGenerating}>
                {briefSaveStatus === "saving" ? "保存中…" : briefSaveStatus === "saved" ? "✓ 已保存" : briefSaveStatus === "error" ? "重新保存商品简报" : "保存商品简报"}
              </button>
            </footer>
          </aside>

          <section className="generation-stage-v3">
            <div className="generation-stage-v3__glow" aria-hidden="true" />
            <header className="generation-stage-v3__head">
              <div>
                <span className="workspace-kicker">生成链路</span>
                <div className="generation-title-row">
                  <h1>{generated ? "生成完成" : isGenerating ? "生成中" : "准备生成"}</h1>
                  <span className={mode === "template" || selectedProvidersReady(selection, modelStatus) ? "is-success" : "is-warning"}><i />{mode === "template" ? "本地模板已就绪" : selectedProvidersReady(selection, modelStatus) ? "所选模型已配置" : "需补充模型配置"}</span>
                </div>
              </div>
              <div className="generation-stage-v3__actions">
                <button type="button" className="button-primary-v3" onClick={handleGenerate} disabled={isGenerating || briefSaveStatus !== "saved"}>{isGenerating ? "执行中" : mode === "template" ? "生成演示" : "执行所选调用"}</button>
                <Link href={"/projects/" + activeProject.id} className="button-secondary-v3">查看项目</Link>
                <Link
                  href={canCreateProject ? "/generate?new=1" : "/projects?notice=project-limit"}
                  className="button-secondary-v3"
                  title={canCreateProject ? "创建新项目" : "当前会话已达到 3 个项目上限，请先管理已有项目"}
                >
                  {canCreateProject ? "新建项目" : "管理项目"}
                </Link>
              </div>
            </header>

            <div className="generation-mode-v3" aria-label="生成方式选择">
              <button type="button" className={mode === "template" ? "is-active" : ""} onClick={() => handleModeChange("template")} disabled={isGenerating}>使用模板</button>
              <button type="button" className={mode === "custom" ? "is-active" : ""} onClick={() => handleModeChange("custom")} disabled={isGenerating}>自定义真实调用</button>
            </div>
            {mode === "custom" ? (
              <div className="generation-call-picker-v3">
                <CallToggle active={selection.deepseek} title="DeepSeek 文本" desc="策略、分镜与提示词" onClick={() => toggleSelection("deepseek")} disabled={isGenerating} />
                <CallToggle active={selection.qwenImage} title="Qwen-Image 关键帧" desc={`生成${briefDraft.shotCount}张关键帧`} onClick={() => toggleSelection("qwenImage")} disabled={isGenerating} />
                <CallToggle active={selection.happyHorse} title="HappyHorse 视频" desc="参考真实产品图生成主镜头" onClick={() => toggleSelection("happyHorse")} disabled={isGenerating} />
              </div>
            ) : null}

            {briefSaveStatus !== "saved" ? <p className="generation-save-gate">请先保存商品简报。</p> : null}
            <WorkflowFlowRail state={{ ...workflowSteps, brief: briefWorkflowStatus(briefSaveStatus) }} briefSaveStatus={briefSaveStatus} onRetry={handleGenerate} />
            {error ? <div className="inline-generation-error">{error}</div> : null}
            <ResultBoard project={previewProject} keyframes={liveKeyframes} callTrace={callTrace} projectId={activeProject.id} generated={generated} isGenerating={isGenerating} />
          </section>

          <aside className="status-rail-v3 status-rail-shell" aria-label="生成状态">
            <StatusSummary title="状态" value={stageStatus} detail={generated ? "可直接进入项目精修" : undefined} tone={generated ? "success" : "default"} />
            <StatusSummary title="调用方式" value={mode === "template" ? "本地模板" : "真实调用"} detail={mode === "template" ? undefined : "服务端密钥已隐藏"} tone="blue" />
            <ModelConfigurationCard status={modelStatus} />
            <section className="trace-flow-v3 model-trace-card" id="trace">
              <div className="trace-flow-v3__head"><span>模型 Trace</span><small>{traceLabel}</small></div>
              <TraceNode name="DeepSeek" task="策略与提示词" active={selection.deepseek || mode === "template"} tone="blue" />
              <TraceNode name="Qwen-Image" task="关键帧生成" active={selection.qwenImage} tone="violet" />
              <TraceNode name="HappyHorse" task="主镜头视频生成" active={selection.happyHorse} tone="yellow" />
              <TraceNode name="Remotion" task="成片合成" active={generated} tone="green" last />
              <details className="trace-footer-v3"><summary>查看执行日志</summary>{callTrace.length ? callTrace.map((item, index) => <TraceLogLine key={`${index}-${item}`} item={item} />) : <p>生成后可查看完整调用记录。</p>}</details>
            </section>
            <footer className="status-rail-footer"><button type="button" className="status-rail-settings" onClick={() => openModelSettings()}>管理模型设置</button></footer>
          </aside>
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
            <footer>
              <button type="button" className="button-secondary-v3" disabled={shotCountSaving} onClick={() => setShotCountDialogOpen(false)}>取消</button>
              <button type="button" className="button-primary-v3" disabled={shotCountSaving || requestedShotCount === getEffectiveShotCount(activeProject)} onClick={() => void regenerateShotCount()}>{shotCountSaving ? "重新生成中" : "确认并重新生成"}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ModelConfigurationCard({ status }: { status: import("@/components/ModelSettingsSheet").ModelSettingsStatus | null }) {
  const rows = [
    { name: "DeepSeek", detail: status?.deepseek.configured ? "已配置" : "未配置", ready: Boolean(status?.deepseek.configured) },
    { name: "Qwen-Image", detail: status?.qwenImage.configured ? "已配置" : "未配置", ready: Boolean(status?.qwenImage.configured) },
    { name: "HappyHorse", detail: status?.happyHorse.apiAvailable ? "已启用" : "未就绪", ready: Boolean(status?.happyHorse.apiAvailable) },
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
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok) {
    return { ...payload, success: false };
  }
  return payload;
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
  if (["idle", "pending", "running", "completed", "failed", "fallback"].includes(status)) {
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
    fallbackReason: frame.fallbackReason ?? null
  }));
}

type ProjectPatchData = {
  project: GenerationProject;
  version: number;
};

async function saveServerBrief(projectId: string, expectedVersion: number, draft: BriefDraft): Promise<ProjectPatchData> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedVersion,
      saveBrief: {
        brief: { ...draft.brief, durationSec: draft.targetDurationSec },
        shotCount: draft.shotCount,
        targetDurationSec: draft.targetDurationSec
      }
    })
  });
  const payload = await response.json().catch(() => null) as { data?: ProjectPatchData; error?: { message?: string } } | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error?.message || "商品简报保存失败，请重试。");
  return payload.data;
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
      const provider = event.provider === "system" ? "系统" : event.provider === "qwen-image" ? "Qwen-Image" : event.provider === "happyhorse" ? "HappyHorse" : event.provider === "remotion" ? "Remotion" : "DeepSeek";
      const progress = event.progressTotal ? `｜${event.progressCurrent ?? 0} / ${event.progressTotal}` : "";
      return `${provider}｜${event.action}｜${eventStatusLabel(event.status)}${progress}｜${event.message}`;
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
    queued: "排队中", running: "执行中", completed: "已完成", failed: "失败", fallback: "已降级",
    cancelled: "已取消", blocked: "已阻塞", interrupted: "已中断"
  };
  return labels[status];
}
