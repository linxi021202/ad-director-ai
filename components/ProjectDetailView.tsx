"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { AIModeBadge, type AITraceStatus } from "@/components/AIModeBadge";
import type { KeyframeResult } from "@/components/KeyframePreview";
import { CinematicWorkspaceBackground } from "@/components/workspace/CinematicWorkspaceBackground";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import {
  buildOptimizedVideoPrompt,
  createLocalDemoHeroVideo,
  DEFAULT_HERO_SHOT_ID,
  getHeroVideoStatus,
  resolveHeroShot,
  setProjectHeroShot,
  validateHeroVideoFile,
  type HeroVideoSource
} from "@/lib/heroVideo";
import { formatFileSize } from "@/lib/productImages";
import type { AspectRatio, GenerationProject, StoryboardShot } from "@/lib/schemas/project";
import { normalizeProjectDuration } from "@/lib/projectDuration";

type ProjectDetailViewProps = {
  project: GenerationProject;
  projectId: string;
  aiStatus: AITraceStatus;
};

type HeroVideoAssetClient = {
  id: string;
  projectId: string;
  shotId: string;
  source: "happyhorse-manual-import" | "happyhorse-api";
  fileName: string;
  mimeType: "video/mp4";
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  aspectRatio: string;
  localPath: string;
  publicUrl: string;
  createdAt: string;
};

type HeroVideoAssetResponse = {
  success: boolean;
  data?: { exists?: boolean; asset?: HeroVideoAssetClient | null; deleted?: boolean } | null;
  error?: string | null;
};

type GenerateImagesResponse = {
  success: boolean;
  data?: { images: Array<Omit<KeyframeResult, "status">> } | null;
  error?: string | null;
};

type RenderStatusState = {
  status: "idle" | "validating" | "narrating" | "bundling" | "rendering" | "encoding" | "completed" | "failed" | "cancelled";
  progress: number;
  stage: string;
  outputUrl: string | null;
  errorMessage: string | null;
  warningMessage?: string | null;
};

type RenderApiResponse = { success: boolean; data?: RenderStatusState | null; error?: string | null };

type FinalVideoApiResponse = {
  success: boolean;
  data?: { outputUrl: string | null; sizeBytes: number; downloadable: boolean } | null;
  error?: string | null;
};

type NarrationAssetClient = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  publicUrl: string;
};

type NarrationApiResponse = {
  success: boolean;
  data?: { exists?: boolean; asset?: NarrationAssetClient | null } | null;
  error?: string | null;
};

type HeroVideoState = {
  source: HeroVideoSource;
  url: string;
  name: string;
  type: string;
  size?: number;
  durationSec?: number | null;
  path?: string;
  width?: number;
  height?: number;
  shotId?: string;
  fallbackReady: boolean;
};

const PROJECT_STORAGE_PREFIX = "adDirector.generatedProject.";
const KEYFRAME_STORAGE_PREFIX = "adDirector.generatedKeyframes.";

export function ProjectDetailView({ project, projectId, aiStatus }: ProjectDetailViewProps) {
  const [displayProject, setDisplayProject] = useState<GenerationProject>(() => normalizeProjectDuration(project));
  const [heroShotId, setHeroShotId] = useState(project.heroShotId || DEFAULT_HERO_SHOT_ID);
  const [keyframes, setKeyframes] = useState<Record<string, KeyframeResult>>({});
  const [activeBatch, setActiveBatch] = useState<"hero-only" | "all-shots" | null>(null);
  const [imageBatchError, setImageBatchError] = useState<string | null>(null);
  const [heroVideo, setHeroVideo] = useState<HeroVideoState | null>(null);
  const [heroVideoError, setHeroVideoError] = useState<string | null>(null);
  const [heroVideoUploading, setHeroVideoUploading] = useState(false);
  const [heroVideoGenerating, setHeroVideoGenerating] = useState(false);
  const [waitingManualUpload, setWaitingManualUpload] = useState(false);
  const [fallbackToKeyframe, setFallbackToKeyframe] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<"raw" | "optimized" | null>(null);
  const [renderStatus, setRenderStatus] = useState<RenderStatusState | null>(null);
  const [finalVideo, setFinalVideo] = useState<{ outputUrl: string; sizeBytes: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [narrationAudio, setNarrationAudio] = useState<NarrationAssetClient | null>(null);
  const [narrationUploading, setNarrationUploading] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const renderPollVersion = useRef(0);

  const heroShot = useMemo(
    () => resolveHeroShot(displayProject.shots, heroShotId) ?? displayProject.shots[0],
    [displayProject.shots, heroShotId]
  );
  const optimizedVideoPrompt = useMemo(() => buildOptimizedVideoPrompt(heroShot), [heroShot]);
  const heroFrameUrl = keyframes[heroShot.id]?.localUrl || keyframes[heroShot.id]?.imageUrl || shotPlaceholderUrl(heroShot.index);
  const heroVideoStatus = getHeroVideoStatus({
    hasHeroShot: Boolean(heroShot),
    promptReady: Boolean(heroShot),
    waitingManualUpload,
    uploading: heroVideoUploading || heroVideoGenerating,
    videoSource: heroVideo?.source ?? null,
    error: heroVideoError,
    fallbackToKeyframe
  });  const renderIsActive = Boolean(renderStatus && isActiveRenderState(renderStatus.status));


  useEffect(() => {
    const storedProject = readStoredProject(project.id);
    if (storedProject) {
      setDisplayProject(normalizeProjectDuration(storedProject));
      setHeroShotId(storedProject.heroShotId || DEFAULT_HERO_SHOT_ID);
    }
    const storedKeyframes = readStoredKeyframes(project.id);
    if (storedKeyframes) setKeyframes(storedKeyframes);
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/hero-video`);
        const payload = (await response.json()) as HeroVideoAssetResponse;
        if (!cancelled && payload.success && payload.data?.exists && payload.data.asset) {
          setHeroShotId(payload.data.asset.shotId);
          setHeroVideo(heroVideoFromAsset(payload.data.asset));
        }
      } catch {
        // Local hero video state is optional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [narrationResponse, renderResponse] = await Promise.all([
          fetch(`/api/projects/${encodeURIComponent(project.id)}/narration`, { cache: "no-store" }),
          fetch(`/api/projects/${encodeURIComponent(project.id)}/render`, { cache: "no-store" })
        ]);
        const narrationPayload = (await narrationResponse.json()) as NarrationApiResponse;
        const renderPayload = (await renderResponse.json()) as RenderApiResponse;
        if (cancelled) return;
        if (narrationPayload.success && narrationPayload.data?.asset) setNarrationAudio(narrationPayload.data.asset);
        if (renderPayload.success && renderPayload.data) {
          setRenderStatus(renderPayload.data);
          if (renderPayload.data.status === "completed") await refreshFinalVideo();
          if (isActiveRenderState(renderPayload.data.status)) void pollRenderStatus();
        }
      } catch {
        // Optional persisted assets can be restored on the next refresh.
      }
    })();
    return () => {
      cancelled = true;
      renderPollVersion.current += 1;
    };
  }, [project.id]);

  async function generateImages(mode: "hero-only" | "all-shots") {
    setImageBatchError(null);
    setActiveBatch(mode);
    const targetShots = mode === "hero-only" ? [heroShot] : displayProject.shots;
    markShotsLoading(targetShots);

    try {
      const response = await fetch("/api/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: displayProject.id,
          shots: displayProject.shots,
          mode,
          aspectRatio: displayProject.brief.aspectRatio,
          productImages: displayProject.brief.productImages ?? []
        })
      });
      const payload = (await response.json()) as GenerateImagesResponse;
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || "关键帧生成失败。");

      setKeyframes((current) => {
        const next = { ...current };
        payload.data?.images.forEach((image) => {
          next[image.shotId] = { ...image, status: image.fallbackUsed ? "failed" : "ready" };
        });
        persistKeyframes(displayProject.id, next);
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "关键帧生成失败。";
      setImageBatchError(message);
      markShotsFailed(targetShots, message);
    } finally {
      setActiveBatch(null);
    }
  }

  function markShotsLoading(shots: StoryboardShot[]) {
    setKeyframes((current) => {
      const next = { ...current };
      shots.forEach((shot) => {
        next[shot.id] = { ...(next[shot.id] ?? { shotId: shot.id }), status: "loading" };
      });
      return next;
    });
  }

  function markShotsFailed(shots: StoryboardShot[], reason: string) {
    setKeyframes((current) => {
      const next = { ...current };
      shots.forEach((shot) => {
        next[shot.id] = {
          ...(next[shot.id] ?? { shotId: shot.id }),
          status: "failed",
          fallbackUsed: true,
          fallbackReason: reason,
          imageUrl: shotPlaceholderUrl(shot.index)
        };
      });
      persistKeyframes(displayProject.id, next);
      return next;
    });
  }

  function handleSetHeroShot(shot: StoryboardShot) {
    setHeroShotId(shot.id);
    setHeroVideo(null);
    setHeroVideoError(null);
    setWaitingManualUpload(false);
    setFallbackToKeyframe(false);
    const next = setProjectHeroShot(displayProject, shot);
    setDisplayProject(next);
    persistProject(next);
    void deleteStoredHeroVideo(displayProject.id);
  }

  async function copyPrompt(kind: "raw" | "optimized", value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedPrompt(kind);
    setWaitingManualUpload(false);
    setFallbackToKeyframe(false);
    window.setTimeout(() => setCopiedPrompt(null), 1200);
  }

  async function handleGenerateHappyHorseVideo() {
    setHeroVideoError(null);
    setHeroVideoGenerating(true);
    setWaitingManualUpload(false);
    setFallbackToKeyframe(false);

    try {
      const heroReferenceUrl = keyframes[heroShot.id]?.localUrl || keyframes[heroShot.id]?.imageUrl;
      if (!heroReferenceUrl) {
        throw new Error("HappyHorse 多参考图生成需要当前主镜头关键帧。请先重新生成当前主镜头关键帧。");
      }
      if (!(displayProject.brief.productImages ?? []).some((image) => image.role !== "logo" && (image.localUrl || image.remoteUrl || image.url))) {
        throw new Error("HappyHorse 多参考图生成需要至少一张已保存的真实产品图。请先返回生成页上传产品主图。");
      }
      const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/happyhorse-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shotId: heroShot.id,
          imageUrl: heroReferenceUrl,
          productImages: displayProject.brief.productImages ?? [],
          prompt: optimizedVideoPrompt,
          aspectRatio: displayProject.brief.aspectRatio,
          durationSec: Math.min(5, Math.max(3, Math.round(heroShot.durationSec || 5)))
        })
      });
      const payload = (await response.json()) as HeroVideoAssetResponse;
      if (!response.ok || !payload.success || !payload.data?.asset) {
        throw new Error(payload.error || "HappyHorse API 调用失败，请检查百炼 Key、模型权限和账户额度。");
      }
      setHeroVideo(heroVideoFromAsset(payload.data.asset));
    } catch (error) {
      setHeroVideoError(error instanceof Error ? error.message : "HappyHorse API 调用失败。");
      setWaitingManualUpload(false);
    } finally {
      setHeroVideoGenerating(false);
    }
  }

  async function handleHeroVideoUpload(file: File) {
    setHeroVideoError(null);
    const validation = validateHeroVideoFile(file);
    if (!validation.success) {
      setHeroVideoError(validation.error);
      return;
    }

    const formData = new FormData();
    formData.set("file", file);
    formData.set("shotId", heroShot.id);
    formData.set("aspectRatio", displayProject.brief.aspectRatio);

    setHeroVideoUploading(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/hero-video`, { method: "POST", body: formData });
      const payload = (await response.json()) as HeroVideoAssetResponse;
      if (!response.ok || !payload.success || !payload.data?.asset) throw new Error(payload.error || "主镜头视频上传失败。");
      setHeroVideo(heroVideoFromAsset(payload.data.asset));
      setWaitingManualUpload(false);
      setFallbackToKeyframe(false);
    } catch (error) {
      setHeroVideoError(error instanceof Error ? error.message : "主镜头视频上传失败。");
    } finally {
      setHeroVideoUploading(false);
    }
  }

  function handleUseLocalDemoVideo() {
    setHeroVideoError(null);
    if (!aiStatus.manualVideoAssetExists) {
      setHeroVideoError(`请将演示视频放入 public${aiStatus.manualVideoAssetPath}`);
      return;
    }
    setHeroVideo(createLocalDemoHeroVideo(aiStatus.manualVideoAssetPath));
    setWaitingManualUpload(false);
    setFallbackToKeyframe(false);
  }

  async function clearHeroVideo() {
    setHeroVideo(null);
    setHeroVideoError(null);
    setWaitingManualUpload(false);
    setFallbackToKeyframe(false);
    await deleteStoredHeroVideo(displayProject.id);
  }

  async function startFinalRender() {
    setRenderError(null);
    if (!heroVideo) {
      setRenderError("请先准备 HappyHorse 主镜头视频，再生成最终 MP4。");
      return;
    }

    setRenderStatus({ status: "validating", progress: 0.02, stage: "正在校验成片素材", outputUrl: null, errorMessage: null });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: { ...displayProject, heroShotId },
          keyframes,
          voiceoverUrl: narrationAudio?.publicUrl
        })
      });
      const payload = (await response.json()) as RenderApiResponse;
      if (response.status === 409 && payload.data) {
        setRenderStatus(payload.data);
        await pollRenderStatus();
        return;
      }
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || "Remotion 渲染启动失败。");
      setRenderStatus(payload.data);
      await pollRenderStatus();
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "Remotion 渲染失败。");
    }
  }

  async function pollRenderStatus() {
    const pollVersion = ++renderPollVersion.current;
    let consecutiveNetworkFailures = 0;
    for (let index = 0; index < 800 && pollVersion === renderPollVersion.current; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/render`, { cache: "no-store" });
        const payload = (await response.json()) as RenderApiResponse;
        if (!payload.success || !payload.data) {
          consecutiveNetworkFailures += 1;
          continue;
        }
        consecutiveNetworkFailures = 0;
        setRenderStatus(payload.data);
        if (payload.data.status === "completed") {
          await refreshFinalVideo();
          return;
        }
        if (["failed", "cancelled"].includes(payload.data.status)) {
          setRenderError(payload.data.errorMessage || "Remotion 渲染失败。");
          return;
        }
      } catch {
        consecutiveNetworkFailures += 1;
        if (consecutiveNetworkFailures >= 8) {
          setRenderError("暂时无法读取渲染进度，任务可能仍在服务端运行。请保持页面打开或稍后刷新恢复。");
        }
      }
    }
    if (pollVersion === renderPollVersion.current) {
      setRenderError("渲染等待时间过长，已停止页面轮询。刷新页面可恢复任务状态，或取消后重试。");
    }
  }

  async function cancelFinalRender() {
    renderPollVersion.current += 1;
    const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/render`, { method: "DELETE" });
    const payload = (await response.json()) as RenderApiResponse;
    if (payload.success && payload.data) setRenderStatus(payload.data);
    setRenderError(payload.error || "渲染任务已取消。");
  }

  async function uploadNarration(file: File) {
    setNarrationError(null);
    const extensionAllowed = /\.(mp3|wav|m4a|aac)$/i.test(file.name);
    if (!extensionAllowed || file.size <= 0 || file.size > 20 * 1024 * 1024) {
      setNarrationError("旁白仅支持 MP3、WAV、M4A、AAC，且不能超过 20MB。");
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    setNarrationUploading(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/narration`, { method: "POST", body: formData });
      const payload = (await response.json()) as NarrationApiResponse;
      if (!response.ok || !payload.success || !payload.data?.asset) throw new Error(payload.error || "旁白音频保存失败。");
      setNarrationAudio(payload.data.asset);
    } catch (error) {
      setNarrationError(error instanceof Error ? error.message : "旁白音频保存失败。");
    } finally {
      setNarrationUploading(false);
    }
  }

  async function removeNarration() {
    const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/narration`, { method: "DELETE" });
    const payload = (await response.json()) as NarrationApiResponse;
    if (!response.ok || !payload.success) {
      setNarrationError(payload.error || "旁白音频删除失败。");
      return;
    }
    setNarrationAudio(null);
    setNarrationError(null);
  }

  async function refreshFinalVideo() {
    const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/final-video`, { cache: "no-store" });
    const payload = (await response.json()) as FinalVideoApiResponse;
    if (payload.success && payload.data?.outputUrl) setFinalVideo({ outputUrl: payload.data.outputUrl, sizeBytes: payload.data.sizeBytes });
  }

  return (
    <main className="project-detail-v3 project-v3 min-h-screen bg-transparent text-white">
      <CinematicWorkspaceBackground />
      <WorkspaceHeader active="项目" projectHref={`/projects/${encodeURIComponent(projectId)}`} trailing={<AIModeBadge status={aiStatus} />} />

      <div className="project-detail-v3__page-shell">
        <header className="project-detail-v3__hero-header">
          <div>
            <h1>{displayProject.brief.productName}</h1>
            <p>关键帧与主镜头精修 · DeepSeek → Qwen-Image → HappyHorse → Remotion</p>
          </div>
          <div className="project-detail-v3__actions">
            <button type="button" className="button-primary-v3" disabled={activeBatch === "hero-only"} onClick={() => void generateImages("hero-only")}>{activeBatch === "hero-only" ? "生成中" : "生成主镜头"}</button>
            <button type="button" className="button-secondary-v3" disabled={activeBatch === "all-shots"} onClick={() => void generateImages("all-shots")}>{activeBatch === "all-shots" ? "生成中" : "生成全部关键帧"}</button>
          </div>
        </header>

        <section className="project-overview-v3">
          <article className="project-preview-card-v3">
            <div className="project-preview-card-v3__media">
              {heroVideo ? <video src={heroVideo.url} controls playsInline /> : <img src={heroFrameUrl} alt="主镜头预览" />}
            </div>
            <footer><span>成片预览 · {displayProject.brief.aspectRatio}</span><strong>{heroVideo ? "视频已就绪" : "等待主镜头视频"}</strong></footer>
          </article>

          <article className="strategy-panel-v3">
            <small>核心创意</small>
            <h2>{displayProject.strategy.bigIdea}</h2>
            <p>{displayProject.strategy.coreMessage}</p>
            <div className="strategy-panel-v3__cards">
              <InfoCard label="目标用户" value={displayProject.strategy.audienceInsight || displayProject.brief.targetAudience} />
              <InfoCard label="情绪钩子" value={displayProject.strategy.emotionalHook} />
              <InfoCard label="行动引导" value={displayProject.strategy.cta} />
            </div>
            <div className="strategy-panel-v3__tags">
              <span>{displayProject.brief.category}</span><span>{displayProject.brief.platform}</span><span>{displayProject.brief.durationSec} 秒</span>
            </div>
          </article>
        </section>

        <section className="model-route-v3">
          <span className="model-route-v3__label">模型路由流程</span>
          <div className="model-route-v3__nodes">
            {routeNodes().map((node) => <div className={`model-route-node-v3 is-${node.tone}`} key={node.name}><i /><strong>{node.name}</strong><small>{node.detail}</small></div>)}
          </div>
        </section>

        {imageBatchError ? <p className="inline-error-text">{imageBatchError}</p> : null}

        <section className="storyboard-section-v3">
          <header><div><small>分镜</small><h2>4 镜头关键帧</h2></div><p>每个镜头可以单独生成关键帧，也可以切换主镜头。</p></header>
          <div className="storyboard-grid-v3">
            {displayProject.shots.map((shot) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                aspectRatio={displayProject.brief.aspectRatio}
                keyframe={keyframes[shot.id]}
                isHeroShot={shot.id === heroShot.id}
                onGenerate={() => void generateSingleShot(shot)}
                onSetHero={() => handleSetHeroShot(shot)}
              />
            ))}
          </div>
        </section>

        <section className="hero-shot-panel-v3" aria-label="主镜头视频准备">
          <div className="hero-shot-panel-v3__media">
            <div className="hero-shot-panel-v3__visual">{heroVideo ? <video src={heroVideo.url} controls playsInline /> : <img src={heroFrameUrl} alt="当前主镜头" />}</div>
            <div><small>主镜头 · 用于视频生成</small><h2>镜头 {heroShot.index} · {heroShot.subtitle}</h2><p>{heroShot.goal}</p></div>
          </div>
          <div className="hero-shot-panel-v3__prompts">
            <PromptBlock title="原始视频提示词" body={heroShot.videoPromptCn} copied={copiedPrompt === "raw"} onCopy={() => void copyPrompt("raw", heroShot.videoPromptCn)} />
            <PromptBlock title="图生视频优化提示词" body={optimizedVideoPrompt} copied={copiedPrompt === "optimized"} onCopy={() => void copyPrompt("optimized", optimizedVideoPrompt)} />
          </div>
          <aside className="hero-shot-panel-v3__status">
            <div className="hero-ready-v3"><i /><div><strong>{heroStatusLabel(heroVideoStatus)}</strong><span>{heroStatusMessage(heroVideoStatus)}</span></div></div>
            {!heroVideo ? <button type="button" className="button-primary-v3" disabled={heroVideoGenerating} onClick={() => void handleGenerateHappyHorseVideo()}>{heroVideoGenerating ? "HappyHorse 调用中..." : "真实调用 HappyHorse"}</button> : <button type="button" className="button-primary-v3" onClick={() => document.querySelector<HTMLVideoElement>(".hero-shot-panel-v3 video")?.play()}>预览主镜头</button>}
            <button type="button" className="button-secondary-v3" onClick={() => void copyPrompt("optimized", optimizedVideoPrompt)}>{copiedPrompt === "optimized" ? "已复制" : "复制给 HappyHorse"}</button>
            <details className="hero-manual-import-v3">
              <summary>备用导入方式</summary>
              <div>
                <label className="button-secondary-v3">{heroVideoUploading ? "上传中..." : "手动上传 HappyHorse 视频"}<input className="sr-only" type="file" accept="video/mp4" disabled={heroVideoUploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleHeroVideoUpload(file); event.target.value = ""; }} /></label>
                <button type="button" onClick={handleUseLocalDemoVideo}>使用本地演示视频</button>
                {heroVideo ? <button type="button" onClick={() => void clearHeroVideo()}>删除视频</button> : <button type="button" onClick={() => { setHeroVideo(null); setFallbackToKeyframe(true); }}>使用关键帧降级</button>}
              </div>
            </details>
            {heroVideo ? <HeroVideoMeta video={heroVideo} /> : null}
            {heroVideoError ? <p className="inline-error-text">{heroVideoError}</p> : null}
          </aside>
        </section>

        <section className="render-panel-v3">
          <div><small>成片合成</small><h2>Remotion {Math.min(30, Math.max(25, displayProject.brief.durationSec || 28))} 秒 MP4</h2><p>{finalRenderCopy(renderStatus, heroVideo, narrationAudio, displayProject.brief.durationSec)}</p></div>
          <div className="render-panel-v3__actions">
            <button type="button" className="button-primary-v3" disabled={!heroVideo || renderIsActive} onClick={() => void startFinalRender()}>{renderIsActive ? "正在生成" : renderStatus?.status === "failed" ? "重新生成 MP4" : "生成最终 MP4"}</button>
            {renderIsActive ? <button type="button" className="button-secondary-v3" onClick={() => void cancelFinalRender()}>取消任务</button> : null}
            {finalVideo ? <Link className="button-secondary-v3" href={finalVideo.outputUrl} download>下载 MP4</Link> : null}
          </div>
          <div className="render-narration-v3">
            <div><strong>旁白音轨</strong><span>{narrationAudio ? `${narrationAudio.fileName} · ${formatFileSize(narrationAudio.sizeBytes)}` : "未上传时将由百炼自动生成中文旁白"}</span></div>
            <div>
              <label className="button-secondary-v3">{narrationUploading ? "上传中" : narrationAudio ? "替换旁白" : "上传旁白"}<input className="sr-only" type="file" accept=".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac" disabled={narrationUploading || renderIsActive} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadNarration(file); event.target.value = ""; }} /></label>
              {narrationAudio ? <button type="button" className="button-secondary-v3" disabled={renderIsActive} onClick={() => void removeNarration()}>删除</button> : null}
            </div>
          </div>
          {renderStatus ? <RenderProgress status={renderStatus} /> : null}
          {renderStatus?.warningMessage ? <p className="inline-warning-text">{renderStatus.warningMessage}</p> : null}
          {narrationError ? <p className="inline-error-text">{narrationError}</p> : null}
          {renderError ? <p className="inline-error-text">{renderError}</p> : null}
        </section>
      </div>
    </main>
  );

  async function generateSingleShot(shot: StoryboardShot) {
    const previousHero = heroShot;
    setHeroShotId(shot.id);
    await generateImages("hero-only");
    setHeroShotId(previousHero.id);
  }
}

function RenderProgress({ status }: { status: RenderStatusState }) {
  const active = isActiveRenderState(status.status);
  const percent = Math.max(0, Math.min(100, Math.round(status.progress * 100)));
  return (
    <div className={`render-task-progress-v3${active ? " is-active" : ""}`} aria-live="polite">
      <div className="render-task-progress-v3__meta"><strong>{status.stage}</strong><span>{percent}%</span></div>
      <div className="render-task-progress-v3__track" role="progressbar" aria-label="成片渲染进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <i style={{ width: `${Math.max(active ? 4 : 0, percent)}%` }} />
      </div>
      {active ? <small>服务端正在处理，关闭后重新打开项目仍可恢复进度。</small> : null}
    </div>
  );
}

function isActiveRenderState(status: RenderStatusState["status"]) {
  return ["validating", "narrating", "bundling", "rendering", "encoding"].includes(status);
}
function InfoCard({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function ShotCard({ shot, keyframe, aspectRatio, isHeroShot, onGenerate, onSetHero }: { shot: StoryboardShot; keyframe?: KeyframeResult; aspectRatio: AspectRatio; isHeroShot: boolean; onGenerate: () => void; onSetHero: () => void }) {
  const imageUrl = keyframe?.localUrl || keyframe?.imageUrl || shotPlaceholderUrl(shot.index);
  return (
    <article className={`keyframe-card-v3${isHeroShot ? " is-hero" : ""}`}>
      <div className="keyframe-card-v3__media" style={{ aspectRatio: aspectRatio.replace(":", " / ") }}><img src={imageUrl} alt={`镜头 ${shot.index}`} />{isHeroShot ? <span className="keyframe-card-v3__hero-badge">当前主镜头</span> : null}</div>
      <div className="keyframe-card-v3__content"><header><div><span>镜头 {shot.index}</span><h3>{shot.subtitle}</h3></div><em>{shot.durationSec} 秒</em></header><p>{shot.visualDescription}</p><div className="keyframe-card-v3__pills"><span>{shot.cameraAngle}</span><span>{shot.cameraMovement}</span><span>{aspectRatio}</span></div>{keyframe?.fallbackUsed ? <span className="keyframe-fallback-badge"><i />已使用本地降级图</span> : null}<div className="keyframe-card-v3__actions"><button type="button" className="keyframe-card-v3__primary" disabled={keyframe?.status === "loading"} onClick={onGenerate}>{keyframe?.status === "loading" ? "生成中" : keyframe?.status === "ready" ? "重新生成" : "生成关键帧"}</button><button type="button" onClick={onSetHero} disabled={isHeroShot}>{isHeroShot ? "当前主镜头" : "设为主镜头"}</button></div></div>
    </article>
  );
}

function PromptBlock({ title, body, copied, onCopy }: { title: string; body: string; copied: boolean; onCopy: () => void }) {
  return <article className="prompt-card"><header className="prompt-card__header"><h3>{title}</h3><button type="button" onClick={onCopy}>{copied ? "已复制" : "复制"}</button></header><div className="prompt-card__body"><p>{body}</p></div></article>;
}

function HeroVideoMeta({ video }: { video: HeroVideoState }) {
  return <div className="ad-hero-video-meta"><span>来源：{videoSourceLabel(video.source)}</span><span>{video.name}</span>{video.size ? <span>{formatFileSize(video.size)}</span> : null}{video.width && video.height ? <span>{video.width}×{video.height}</span> : null}{video.durationSec ? <span>{formatDuration(video.durationSec)}</span> : null}</div>;
}

function heroVideoFromAsset(asset: HeroVideoAssetClient): HeroVideoState {
  return { source: asset.source, url: asset.publicUrl, name: asset.fileName, type: asset.mimeType, size: asset.sizeBytes, durationSec: asset.durationSec, width: asset.width, height: asset.height, path: asset.publicUrl, shotId: asset.shotId, fallbackReady: true };
}

function videoSourceLabel(source: HeroVideoSource) {
  if (source === "happyhorse-api") return "HappyHorse API";
  if (source === "happyhorse" || source === "happyhorse-manual-import") return "HappyHorse 手动导入";
  return "本地演示素材";
}

function heroStatusLabel(status: ReturnType<typeof getHeroVideoStatus>) {
  const labels: Record<ReturnType<typeof getHeroVideoStatus>, string> = { "not-started": "未开始", "prompt-ready": "HappyHorse API 已就绪", "waiting-manual-upload": "备用导入", uploading: "处理中", uploaded: "主镜头已就绪", "using-demo-asset": "演示素材已就绪", failed: "准备失败", "fallback-to-keyframe": "关键帧降级" };
  return labels[status];
}

function heroStatusMessage(status: ReturnType<typeof getHeroVideoStatus>) {
  const messages: Record<ReturnType<typeof getHeroVideoStatus>, string> = { "not-started": "请先选择主镜头。", "prompt-ready": "默认使用真实产品图与主镜头关键帧调用 HappyHorse。", "waiting-manual-upload": "真实调用不可用时可手动导入。", uploading: "正在处理主镜头视频。", uploaded: "可进入最终成片合成。", "using-demo-asset": "已使用本地演示素材。", failed: "请检查百炼配置后重试；手动上传仅作备用。", "fallback-to-keyframe": "将使用关键帧动效降级。" };
  return messages[status];
}

function routeNodes() {
  return [{ name: "DeepSeek", detail: "策略与提示词", tone: "blue" }, { name: "Qwen-Image", detail: "关键帧生成", tone: "violet" }, { name: "HappyHorse", detail: "多参考图视频", tone: "yellow" }, { name: "Remotion", detail: "成片合成", tone: "green" }] as const;
}

function finalRenderCopy(status: RenderStatusState | null, heroVideo: HeroVideoState | null, narrationAudio: NarrationAssetClient | null, durationSec: number) {
  const duration = Math.min(30, Math.max(25, durationSec || 28));
  if (!heroVideo) return "请先准备 HappyHorse 主镜头视频，再生成最终 MP4。";
  if (status?.status === "completed") return "最终成片已导出，可预览和下载。";
  if (status && isActiveRenderState(status.status)) return `正在合成：${status.stage}`;
  return narrationAudio
    ? `使用四张关键帧、主镜头视频、旁白、字幕与卖点关键词合成 ${duration} 秒广告片。`
    : `将自动生成中文旁白，并与四张关键帧、主镜头视频、字幕及卖点关键词合成 ${duration} 秒广告片。`;
}

function formatDuration(durationSec: number) {
  const rounded = Math.round(durationSec);
  return `00:${String(rounded).padStart(2, "0")}`;
}

function shotPlaceholderUrl(index: number) {
  if (index === 2) return "/generated/images/coldbrew-demo-001/shot-2.png";
  if (index === 3) return "/generated/images/coldbrew-demo-001/shot-3.png";
  if (index === 4) return "/generated/images/coldbrew-demo-001/shot-4.png";
  return "/landing-cold-brew-hero.png";
}

function readStoredProject(projectId: string) {
  try { return JSON.parse(window.sessionStorage.getItem(PROJECT_STORAGE_PREFIX + projectId) || "null") as GenerationProject | null; } catch { return null; }
}

function persistProject(project: GenerationProject) {
  window.sessionStorage.setItem(PROJECT_STORAGE_PREFIX + project.id, JSON.stringify(project));
}

function readStoredKeyframes(projectId: string) {
  try { return JSON.parse(window.sessionStorage.getItem(KEYFRAME_STORAGE_PREFIX + projectId) || "null") as Record<string, KeyframeResult> | null; } catch { return null; }
}

function persistKeyframes(projectId: string, keyframes: Record<string, KeyframeResult>) {
  window.sessionStorage.setItem(KEYFRAME_STORAGE_PREFIX + projectId, JSON.stringify(keyframes));
}

async function deleteStoredHeroVideo(projectId: string) {
  await fetch(`/api/projects/${encodeURIComponent(projectId)}/hero-video`, { method: "DELETE" }).catch(() => undefined);
}






