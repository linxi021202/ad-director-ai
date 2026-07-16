"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ModelSettingsSheet, type ProviderId } from "@/components/ModelSettingsSheet";
import { ModelSettingsTrigger } from "@/components/model-settings/ModelSettingsTrigger";
import { useModelSettingsStatus } from "@/components/model-settings/useModelSettingsStatus";
import { AIModeBadge, type AITraceStatus } from "@/components/AIModeBadge";
import { CinematicWorkspaceBackground } from "@/components/workspace/CinematicWorkspaceBackground";
import { CreativeDirectorFlow } from "@/components/CreativeDirectorFlow";
import { WorkflowFlowRail, idleWorkflowSteps, type WorkflowStepKey, type WorkflowStepState, type WorkflowStepStatus } from "@/components/WorkflowFlowRail";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import { ProductImageUploader } from "@/components/ProductImageUploader";
import type { KeyframeResult } from "@/components/KeyframePreview";
import { buildOptimizedVideoPrompt, resolveHeroShot } from "@/lib/heroVideo";
import type { AdStrategy, AspectRatio, GenerationProject, Platform, ProductBrief, StoryboardShot } from "@/lib/schemas/project";
import { normalizeProjectDuration } from "@/lib/projectDuration";

type GenerateWorkflowProps = {
  project: GenerationProject;
  aiStatus: AITraceStatus;
};

type GenerationMode = "template" | "custom";
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
const PROJECT_STORAGE_PREFIX = "adDirector.generatedProject.";
const KEYFRAME_STORAGE_PREFIX = "adDirector.generatedKeyframes.";
const WORKFLOW_STORAGE_PREFIX = "adDirector.workflowSteps.";
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

export function GenerateWorkflow({ project, aiStatus }: GenerateWorkflowProps) {
  const [generated, setGenerated] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStepState>(idleWorkflowSteps);
  const [mode, setMode] = useState<GenerationMode>("template");
  const [selection, setSelection] = useState<CallSelection>({ deepseek: true, qwenImage: true, happyHorse: true });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceLabel, setTraceLabel] = useState("未调用");
  const [callTrace, setCallTrace] = useState<string[]>([]);
  const [activeProject, setActiveProject] = useState<GenerationProject>(() => normalizeProjectDuration(project));
  const [liveKeyframes, setLiveKeyframes] = useState<GenerateImagesData["images"]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState<ProviderId | undefined>();
  const [settingsGuidance, setSettingsGuidance] = useState<string | null>(null);
  const { status: modelStatus, setStatus: setModelStatus } = useModelSettingsStatus();

  useEffect(() => {
    const storedWorkflow = window.sessionStorage.getItem(WORKFLOW_STORAGE_PREFIX + project.id);
    if (storedWorkflow) { try { setWorkflowSteps(JSON.parse(storedWorkflow) as WorkflowStepState); } catch { setWorkflowSteps(idleWorkflowSteps); } }
    try {
      const storedProject = JSON.parse(window.sessionStorage.getItem(projectStorageKey(project.id)) || "null") as GenerationProject | null;
      if (storedProject) { setActiveProject(normalizeProjectDuration(storedProject)); setGenerated(true); }
    } catch { setActiveProject(project); }
    setLiveKeyframes(readStoredKeyframes(project.id));
  }, [project.id, project]);

  function commitWorkflow(next: WorkflowStepState) { setWorkflowSteps(next); window.sessionStorage.setItem(WORKFLOW_STORAGE_PREFIX + activeProject.id, JSON.stringify(next)); }
  function patchWorkflow(patch: Partial<WorkflowStepState>) { setWorkflowSteps((current) => { const next={...current,...patch}; window.sessionStorage.setItem(WORKFLOW_STORAGE_PREFIX + activeProject.id, JSON.stringify(next)); return next; }); }
  function setStep(key: WorkflowStepKey, status: WorkflowStepStatus) { patchWorkflow({ [key]: status }); }

  function handleModeChange(nextMode: GenerationMode) {
    setMode(nextMode);
    setGenerated(false);
    setIsGenerating(false);
    commitWorkflow(idleWorkflowSteps);
    setError(null);
    setTraceLabel("未调用");
    setCallTrace([]);
  }

  function updateBrief(patch: Partial<ProductBrief>) {
    setGenerated(false);
    setError(null);
    setTraceLabel("未调用");
    setCallTrace([]);
    setActiveProject((current) => ({
      ...current,
      brief: { ...current.brief, ...patch },
      status: "draft",
      updatedAt: new Date().toISOString()
    }));
  }

  function resetBriefToTemplate() {
    setGenerated(false);
    setError(null);
    commitWorkflow(idleWorkflowSteps);
    setTraceLabel("未调用");
    setCallTrace([]);
    setActiveProject(project);
    clearGeneratedState(project.id);
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
    if (selection.happyHorse && (!modelStatus?.happyHorse.configured || !modelStatus.happyHorse.apiAvailable)) return { provider: "happyhorse" as const, guidance: "真实生成主镜头前需要配置百炼 Key，并启用 HappyHorse 真实视频调用。" };
    return null;
  }

  async function handleGenerate() {
    setError(null);
    const missing = missingRequiredProvider();
    if (missing) {
      setError(missing.guidance);
      openModelSettings(missing.provider, missing.guidance);
      return;
    }
    setGenerated(false);
    commitWorkflow({ brief: "completed", strategy: mode === "template" || selection.deepseek ? "running" : "completed", storyboard: "pending", keyframes: "pending", heroShot: "pending", render: "pending" });
    setCallTrace([]);

    if (mode === "template") {
      setIsGenerating(true);
      const templateProject = { ...activeProject, status: "completed" as const, updatedAt: new Date().toISOString() };
      setActiveProject(templateProject);
      setTraceLabel("本地模板生成中");
      commitWorkflow({ brief: "completed", strategy: "completed", storyboard: "completed", keyframes: "fallback", heroShot: "fallback", render: "fallback" });
      setTraceLabel("本地模板完成");
      persistGeneratedProject(templateProject);
      clearGeneratedKeyframes(templateProject.id);
      setLiveKeyframes([]);
      setCallTrace(["模板：使用当前商品简报 + 冷萃演示策略/分镜", "外部模型：未调用"]);
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
      let generatedImages: GenerateImagesData["images"] = readStoredKeyframes(activeProject.id);
      const traces: string[] = [];

      if (selection.deepseek) {
        setTraceLabel("DeepSeek 文本调用中");
        const strategyResponse = await postApi<{ strategy: AdStrategy }>("/api/generate-strategy", { brief: workingProject.brief });
        if (!strategyResponse.success || !strategyResponse.data?.strategy) {
          throw new Error(strategyResponse.error || "策略生成失败，请检查 DeepSeek 配置。");
        }
        patchWorkflow({ strategy: strategyResponse.fallbackUsed ? "fallback" : "completed", storyboard: "running" });

        const storyboardResponse = await postApi<{ shots: StoryboardShot[] }>("/api/generate-storyboard", {
          brief: workingProject.brief,
          strategy: strategyResponse.data.strategy
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
        persistGeneratedProject(workingProject);
        traces.push(formatDeepSeekTrace("策略", strategyResponse));
        traces.push(formatDeepSeekTrace("分镜", storyboardResponse));
      } else {
        patchWorkflow({ strategy: "completed", storyboard: "completed", keyframes: selection.qwenImage ? "running" : "pending" });
        traces.push("DeepSeek：未选择，沿用当前商品简报/分镜");
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
        persistKeyframes(workingProject.id, generatedImages);
        setLiveKeyframes(generatedImages);
        traces.push(formatQwenImageTrace(imageResponse.data));
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
          durationSec: Math.min(5, Math.max(3, Math.round(selectedHeroShot.durationSec || 5)))
        });
        if (!videoResponse.success || !videoResponse.data?.asset) {
          throw new Error(videoResponse.error || "HappyHorse 主镜头生成失败，请检查百炼 Key、模型权限和账户状态。");
        }
        setStep("heroShot", "completed");
        traces.push("HappyHorse｜多参考图视频完成｜已参考真实产品图并保存为项目主镜头");
      }

      setWorkflowSteps((current) => { const next: WorkflowStepState = { ...current, keyframes: selection.qwenImage ? current.keyframes : "fallback", heroShot: selection.happyHorse ? current.heroShot : "pending", render: "pending" }; window.sessionStorage.setItem(WORKFLOW_STORAGE_PREFIX + activeProject.id, JSON.stringify(next)); return next; });

      setCallTrace(traces);
      setTraceLabel(traces.some((item) => item.includes("回退")) ? "部分回退完成" : "所选调用完成");
      setGenerated(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "真实调用失败。请确认服务端环境变量已配置。不同 Key 不会在前端显示。");
      setTraceLabel("调用失败");
      setWorkflowSteps((current) => { const running = (Object.entries(current).find(([, status]) => status === "running")?.[0] ?? "strategy") as WorkflowStepKey; const next={...current,[running]:"failed" as const}; window.sessionStorage.setItem(WORKFLOW_STORAGE_PREFIX + activeProject.id, JSON.stringify(next)); return next; });
    } finally {
      setIsGenerating(false);
    }
  }

  const stageStatus = generated ? "已就绪" : isGenerating ? "生成中" : "等待生成";

  return (
    <main className="workbench-v3">
      <CinematicWorkspaceBackground />
      <WorkspaceHeader active="工作台" projectHref={"/projects/" + activeProject.id} trailing={<><ModelSettingsTrigger status={modelStatus} onClick={() => openModelSettings()} className="workspace-model-settings-trigger" /><AIModeBadge status={aiStatus} /></>} />

      <div className="workbench-v3__page">
        <nav className="workspace-breadcrumb" aria-label="面包屑">
          <Link href="/generate">工作台</Link><span>›</span><span>生成工作台</span><span>›</span><strong>{activeProject.brief.productName}</strong>
        </nav>

        <section className="workbench-layout">
          <aside className="brief-panel-v3 brief-sidebar-shell">
            <div className="brief-panel-v3__head">
              <div><span>商品简报</span><h2>{activeProject.brief.productName || "未命名商品"}</h2></div>
              <button type="button" onClick={resetBriefToTemplate} disabled={isGenerating}>恢复模板</button>
            </div>
            <div className="brief-sidebar-content"><EditableBriefForm brief={activeProject.brief} disabled={isGenerating} onChange={updateBrief} />
            <ProductImageUploader projectId={activeProject.id} images={activeProject.brief.productImages ?? []} disabled={isGenerating} onChange={(images) => updateBrief({ productImages: images })} />
            </div>
            <footer className="brief-sidebar-footer">简报将在生成项目时保存</footer>
          </aside>

          <section className="generation-stage-v3">
            <div className="generation-stage-v3__glow" aria-hidden="true" />
            <header className="generation-stage-v3__head">
              <div>
                <span className="workspace-kicker">生成链路</span>
                <div className="generation-title-row">
                  <h1>{generated ? "生成完成" : isGenerating ? "生成中" : "准备生成"}</h1>
                  <span className={mode === "template" || (modelStatus?.deepseek.configured && (!selection.qwenImage || modelStatus.qwenImage.configured) && (!selection.happyHorse || modelStatus.happyHorse.apiAvailable)) ? "is-success" : "is-warning"}><i />{mode === "template" ? "本地模板已就绪" : modelStatus?.deepseek.configured && (!selection.qwenImage || modelStatus.qwenImage.configured) && (!selection.happyHorse || modelStatus.happyHorse.apiAvailable) ? "所选模型已配置" : "需补充模型配置"}</span>
                </div>
              </div>
              <div className="generation-stage-v3__actions">
                <button type="button" className="button-primary-v3" onClick={handleGenerate} disabled={isGenerating}>{isGenerating ? "执行中" : mode === "template" ? "生成演示" : "执行所选调用"}</button>
                <Link href={"/projects/" + activeProject.id} className="button-secondary-v3">查看项目</Link>
              </div>
            </header>

            <div className="generation-mode-v3" aria-label="生成方式选择">
              <button type="button" className={mode === "template" ? "is-active" : ""} onClick={() => handleModeChange("template")} disabled={isGenerating}>使用模板</button>
              <button type="button" className={mode === "custom" ? "is-active" : ""} onClick={() => handleModeChange("custom")} disabled={isGenerating}>自定义真实调用</button>
            </div>
            {mode === "custom" ? (
              <div className="generation-call-picker-v3">
                <CallToggle active={selection.deepseek} title="DeepSeek 文本" desc="策略、分镜与提示词" onClick={() => toggleSelection("deepseek")} disabled={isGenerating} />
                <CallToggle active={selection.qwenImage} title="Qwen-Image 关键帧" desc="生成四张关键帧" onClick={() => toggleSelection("qwenImage")} disabled={isGenerating} />
                <CallToggle active={selection.happyHorse} title="HappyHorse 多参考图视频" desc="真实产品图 + 主镜头关键帧" onClick={() => toggleSelection("happyHorse")} disabled={isGenerating} />
              </div>
            ) : null}

            <WorkflowFlowRail state={workflowSteps} onRetry={handleGenerate} />
            {error ? <div className="inline-generation-error">{error}</div> : null}
            <ResultBoard project={activeProject} keyframes={liveKeyframes} callTrace={callTrace} projectId={activeProject.id} generated={generated} isGenerating={isGenerating} />
          </section>

          <aside className="status-rail-v3 status-rail-shell" aria-label="生成状态">
            <StatusSummary title="状态" value={stageStatus} detail={generated ? "可直接进入项目精修" : undefined} tone={generated ? "success" : "default"} />
            <StatusSummary title="调用方式" value={mode === "template" ? "本地模板" : "真实调用"} detail={mode === "template" ? undefined : "服务端密钥已隐藏"} tone="blue" />
            <ModelConfigurationCard status={modelStatus} />
            <section className="trace-flow-v3 model-trace-card" id="trace">
              <div className="trace-flow-v3__head"><span>模型 Trace</span><small>{traceLabel}</small></div>
              <TraceNode name="DeepSeek" task="策略与提示词" active={selection.deepseek || mode === "template"} tone="blue" />
              <TraceNode name="Qwen-Image" task="关键帧生成" active={selection.qwenImage} tone="violet" />
              <TraceNode name="HappyHorse" task="主镜头视频" active={selection.happyHorse} tone="yellow" />
              <TraceNode name="Remotion" task="成片合成" active={generated} tone="green" last />
              <details className="trace-footer-v3"><summary>查看执行日志</summary>{callTrace.length ? callTrace.map((item) => <TraceLogLine key={item} item={item} />) : <p>生成后可查看完整调用记录。</p>}</details>
            </section>
            <footer className="status-rail-footer"><button type="button" className="status-rail-settings" onClick={() => openModelSettings()}>管理模型设置</button></footer>
          </aside>
        </section>
      </div>
      <ModelSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} status={modelStatus} onStatusChange={setModelStatus} initialProvider={settingsProvider} guidance={settingsGuidance} />
    </main>
  );
}

function ModelConfigurationCard({ status }: { status: import("@/components/ModelSettingsSheet").ModelSettingsStatus | null }) {
  const rows = [
    { name: "DeepSeek", detail: status?.deepseek.configured ? "已配置" : "未配置", ready: Boolean(status?.deepseek.configured) },
    { name: "Qwen-Image", detail: status?.qwenImage.configured ? "已配置" : "未配置", ready: Boolean(status?.qwenImage.configured) },
    { name: "HappyHorse", detail: status?.happyHorse.apiAvailable ? "真实调用" : status?.happyHorse.configured ? "待启用" : "未配置", ready: Boolean(status?.happyHorse.apiAvailable) },
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

function CallToggle({ active, title, desc, onClick, disabled, muted = false }: { active: boolean; title: string; desc: string; onClick: () => void; disabled: boolean; muted?: boolean }) {
  return (
    <button type="button" className={`ad-call-toggle ${active ? "is-active" : ""} ${muted ? "is-muted" : ""}`} onClick={onClick} disabled={disabled}>
      <span>{active ? "已选择" : "可选择"}</span>
      <strong>{title}</strong>
      <small>{desc}</small>
    </button>
  );
}

function EditableBriefForm({ brief, disabled, onChange }: { brief: ProductBrief; disabled: boolean; onChange: (patch: Partial<ProductBrief>) => void }) {
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
            <label><span>平台</span><select value={brief.platform} disabled={disabled} onChange={(event) => onChange({ platform: event.target.value as Platform })}><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="ecommerce">电商</option></select></label>
            <label><span>画幅</span><select value={brief.aspectRatio} disabled={disabled} onChange={(event) => onChange({ aspectRatio: event.target.value as AspectRatio })}><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="16:9">16:9</option></select></label>
            <label><span>时长</span><input type="number" min={25} max={30} value={brief.durationSec} disabled={disabled} onChange={(event) => onChange({ durationSec: Number.parseInt(event.target.value || "28", 10) })} /></label>
          </div>
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
        <header><div><strong>镜头概览</strong><span>共 4 个镜头</span></div><Link href={"/projects/" + projectId}>查看完整分镜脚本</Link></header>
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

      {callTrace.length > 0 ? <details className="result-log-v3"><summary>查看本次生成日志</summary>{callTrace.map((item) => <TraceLogLine key={item} item={item} />)}</details> : null}
    </div>
  );
}

function shotPreviewUrl(shot: StoryboardShot, keyframes: GenerateImagesData["images"]) {
  const generated = keyframes.find((image) => image.shotId === shot.id);
  if (generated?.localUrl || generated?.imageUrl) return generated.localUrl || generated.imageUrl!;
  if (shot.index === 2) return "/generated/images/coldbrew-demo-001/shot-2.png";
  if (shot.index === 3) return "/generated/images/coldbrew-demo-001/shot-3.png";
  if (shot.index === 4) return "/generated/images/coldbrew-demo-001/shot-4.png";
  return "/landing-cold-brew-hero.png";
}

function projectStorageKey(projectId: string) {
  return `${PROJECT_STORAGE_PREFIX}${projectId}`;
}

function keyframeStorageKey(projectId: string) {
  return `${KEYFRAME_STORAGE_PREFIX}${projectId}`;
}

function persistGeneratedProject(project: GenerationProject) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(projectStorageKey(project.id), JSON.stringify(project));
}

function readStoredKeyframes(projectId: string): GenerateImagesData["images"] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.sessionStorage.getItem(keyframeStorageKey(projectId)) || "{}") as Record<string, KeyframeResult>;
    return Object.values(value).map(({ status: _status, ...image }) => image as GenerateImagesData["images"][number]);
  } catch {
    return [];
  }
}

function persistKeyframes(projectId: string, images: GenerateImagesData["images"]) {
  if (typeof window === "undefined") return;
  const keyframes = images.reduce<Record<string, KeyframeResult>>((acc, image) => {
    acc[image.shotId] = {
      ...image,
      status: image.fallbackUsed ? "failed" : "ready"
    };
    return acc;
  }, {});
  window.sessionStorage.setItem(keyframeStorageKey(projectId), JSON.stringify(keyframes));
}

function clearGeneratedState(projectId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(projectStorageKey(projectId));
  window.sessionStorage.removeItem(keyframeStorageKey(projectId));
}
function clearGeneratedKeyframes(projectId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(keyframeStorageKey(projectId));
}
















