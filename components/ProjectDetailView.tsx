"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AIModeBadge, type AITraceStatus } from "@/components/AIModeBadge";
import type { KeyframeResult } from "@/components/KeyframePreview";
import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import { VisualAssetPlaceholder } from "@/components/VisualAssetPlaceholder";
import { ShotDetailsSheet, type ShotDetailsTab } from "@/components/ShotDetailsSheet";
import { CinematicWorkspaceBackground } from "@/components/workspace/CinematicWorkspaceBackground";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { readClientApiResponse } from "@/lib/api/clientResponse";
import { generateProjectKeyframes, pollProjectKeyframes } from "@/lib/image/keyframeGenerationClient";
import {
  buildOptimizedVideoPrompt,
  DEFAULT_HERO_SHOT_ID,
  getHeroVideoStatus,
  resolveHeroShot,
  setProjectHeroShot,
  validateHeroVideoFile,
  type HeroVideoSource
} from "@/lib/heroVideo";
import { formatFileSize, resolveProductImageUrl } from "@/lib/productImages";
import { clearProjectGenerationEvents } from "@/lib/projects/clientGenerationEvents";
import type { AspectRatio, GenerationProject, ShotFrame, StoryboardShot } from "@/lib/schemas/project";
import {
  DEFAULT_SHOT_DURATION_SEC,
  MAX_SHOT_COUNT,
  MAX_SHOT_DURATION_SEC,
  MIN_SHOT_COUNT,
  MIN_SHOT_DURATION_SEC,
  allocateShotDurations,
  clampShotCount,
  clampTargetDuration,
  getProjectDurationSec
} from "@/lib/video/shotConfig";
import { normalizeProjectDuration } from "@/lib/projectDuration";

type ProjectDetailViewProps = {
  project: GenerationProject;
  projectId: string;
  projectVersion: number;
  aiStatus: AITraceStatus;
};

type HeroVideoAssetClient = {
  assetId: string;
  projectId: string;
  shotId: string;
  source: "user-upload" | "wan-api" | "happyhorse-manual-import" | "happyhorse-api";
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
  data?: {
    exists?: boolean;
    asset?: HeroVideoAssetClient | null;
    deleted?: boolean;
    status?: "running" | "qa-review" | "needs-review" | "completed";
    eventId?: string;
    taskId?: string;
  } | null;
  error?: string | null;
};

type GenerateImagesResponse = {
  success: boolean;
  data?: {
    status: "running" | "completed";
    eventId: string;
    generatedShots?: number;
    requestedShots?: number;
    images: Array<KeyframeResult>;
  } | null;
  error?: string | null;
};

type RenderStatusState = {
  status: "idle" | "queued" | "validating" | "narrating" | "bundling" | "rendering" | "encoding" | "completed" | "failed" | "cancelled";
  progress: number;
  stage: string;
  outputUrl: string | null;
  errorMessage: string | null;
  warningMessage?: string | null;
};

type RenderApiResponse = { success: boolean; data?: RenderStatusState | null; error?: string | null };

type ProjectApiData = {
  project: GenerationProject;
  version: number;
  shotCount: number;
  totalDurationSec: number;
};

type ProjectApiResponse = {
  success?: boolean;
  data?: ProjectApiData | null;
  error?: { code?: string; message?: string } | string | null;
};
type FinalVideoApiResponse = {
  success: boolean;
  data?: {
    outputUrl: string | null;
    downloadUrl: string | null;
    sizeBytes: number;
    downloadable: boolean;
  } | null;
  error?: string | null;
};

type VideoLibraryItemClient = {
  id: string;
  projectId: string;
  projectName: string;
  kind: "hero-video" | "final-video";
  source: "user-upload" | "qwen-image" | "wan-api" | "happyhorse-manual-import" | "happyhorse-api" | "remotion" | "system-demo";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  createdAt: string;
  url: string;
  downloadUrl: string;
};

type VideoLibraryApiResponse = {
  success: boolean;
  data?: { videos?: VideoLibraryItemClient[] } | null;
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

type ProjectSectionId = "overview" | "keyframes" | "hero-shot" | "final";
type ProjectStepStatus = "completed" | "running" | "qa-review" | "needs-review" | "pending" | "failed" | "fallback" | "blocked";
type ProjectWorkflowStep = {
  id: string;
  label: string;
  status: ProjectStepStatus;
  detail: string;
};

type NextProjectAction = {
  kind: "keyframes" | "navigate" | "render";
  label: string;
  section: ProjectSectionId;
};

export function ProjectDetailView({ project, projectId, projectVersion, aiStatus }: ProjectDetailViewProps) {
  const [displayProject, setDisplayProject] = useState<GenerationProject>(() => normalizeProjectDuration(project));
  const [currentVersion, setCurrentVersion] = useState(projectVersion);
  const [heroShotId, setHeroShotId] = useState<string | undefined>(project.heroShotId ?? undefined);
  const [keyframes, setKeyframes] = useState<Record<string, KeyframeResult>>(() => projectKeyframesRecord(project));
  const [activeBatch, setActiveBatch] = useState<"hero-only" | "all-shots" | null>(null);
  const [imageBatchError, setImageBatchError] = useState<string | null>(null);
  const [heroVideo, setHeroVideo] = useState<HeroVideoState | null>(null);
  const [heroVideoError, setHeroVideoError] = useState<string | null>(null);
  const [heroVideoUploading, setHeroVideoUploading] = useState(false);
  const [heroVideoGenerating, setHeroVideoGenerating] = useState(false);
  const [heroVideoElapsedSec, setHeroVideoElapsedSec] = useState(0);
  const [waitingManualUpload, setWaitingManualUpload] = useState(false);
  const [fallbackToKeyframe, setFallbackToKeyframe] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<"raw" | "optimized" | null>(null);
  const [renderStatus, setRenderStatus] = useState<RenderStatusState | null>(null);
  const [finalVideo, setFinalVideo] = useState<{
    outputUrl: string;
    downloadUrl: string;
    sizeBytes: number;
  } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [videoLibrary, setVideoLibrary] = useState<VideoLibraryItemClient[]>([]);
  const [videoLibraryLoading, setVideoLibraryLoading] = useState(true);
  const [videoLibraryError, setVideoLibraryError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ProjectSectionId>("overview");
  const [detailsShotId, setDetailsShotId] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<ShotDetailsTab>("image");
  const [durationSavingShotId, setDurationSavingShotId] = useState<string | null>(null);
  const [timelineRebalancing, setTimelineRebalancing] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [shotCountDialogOpen, setShotCountDialogOpen] = useState(false);
  const [requestedShotCount, setRequestedShotCount] = useState(() => Math.max(MIN_SHOT_COUNT, Math.min(MAX_SHOT_COUNT, project.shots.length)));
  const [shotCountRegenerating, setShotCountRegenerating] = useState(false);
  const [shotCountElapsedSec, setShotCountElapsedSec] = useState(0);
  const shotCountOperationRef = useRef(false);
  const renderPollVersion = useRef(0);

  const heroShot = useMemo(
    () => resolveHeroShot(displayProject.shots, heroShotId) ?? displayProject.shots[0],
    [displayProject.shots, heroShotId]
  );
  const projectDurationSec = getProjectDurationSec(displayProject);
  const targetDurationSec = displayProject.targetDurationSec ?? displayProject.brief.durationSec;
  const durationDiffersFromTarget = projectDurationSec !== targetDurationSec;
  const optimizedVideoPrompt = useMemo(() => buildOptimizedVideoPrompt(heroShot), [heroShot]);
  const heroKeyframe = primaryShotKeyframe(heroShot, keyframes);
  const heroFrameUrl = heroKeyframe?.localUrl || heroKeyframe?.imageUrl;
  const heroVideoStatus = getHeroVideoStatus({
    hasHeroShot: Boolean(displayProject.heroShotId && heroShot),
    promptReady: Boolean(heroShot),
    waitingManualUpload,
    uploading: heroVideoUploading,
    videoSource: heroVideo?.source ?? null,
    error: heroVideoError,
    fallbackToKeyframe
  });
  const renderIsActive = Boolean(renderStatus && isActiveRenderState(renderStatus.status));
  const totalKeyframeCount = displayProject.shots.reduce((sum, shot) => sum + Math.max(1, shot.frames?.length ?? 0), 0);
  const completedKeyframeCount = displayProject.shots.reduce((sum, shot) => sum + (shot.frames?.length
    ? shot.frames.filter((frame) => isUsableKeyframe(keyframes[frame.id])).length
    : Number(isUsableKeyframe(keyframes[shot.id]))), 0);
  const allKeyframesReady = completedKeyframeCount === displayProject.shots.length;
  const missingKeyframeShots = displayProject.shots.filter((shot) => !isShotKeyframesComplete(shot, keyframes));
  const productMediaUrl = resolveProductImageUrl(
    (displayProject.brief.productImages ?? []).find((image) => image.role === "main-product")
      ?? displayProject.brief.productImages?.[0]
  );
  const detailsShot = detailsShotId
    ? displayProject.shots.find((shot) => shot.id === detailsShotId) ?? null
    : null;
  const nextAction = resolveNextProjectAction({
    missingKeyframes: missingKeyframeShots.length,
    hasHeroShot: Boolean(displayProject.heroShotId && heroShot),
    hasHeroVideo: Boolean(heroVideo),
    renderStatus: renderStatus?.status,
    hasFinalVideo: Boolean(finalVideo)
  });
  const projectSteps = buildProjectSteps({
    project: displayProject,
    keyframes,
    activeBatch,
    imageBatchError,
    heroVideo,
    heroVideoUploading,
    heroVideoError,
    fallbackToKeyframe,
    renderStatus,
    finalVideo
  });

  const refreshVideoLibrary = useCallback(async () => {
    setVideoLibraryLoading(true);
    try {
      const response = await fetch("/api/video-library", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as VideoLibraryApiResponse | null;
      if (!response.ok || !payload?.success || !payload.data?.videos) {
        throw new Error(payload?.error || "视频库读取失败。");
      }
      setVideoLibrary(payload.data.videos);
      setVideoLibraryError(null);
    } catch (error) {
      setVideoLibraryError(error instanceof Error ? error.message : "视频库读取失败。");
    } finally {
      setVideoLibraryLoading(false);
    }
  }, []);

  async function resetGenerationLogForNewRun() {
    const result = await clearProjectGenerationEvents(displayProject.id);
    setCurrentVersion((current) => Math.max(current, result.version));
    setDisplayProject((current) => ({ ...current, generationEvents: [] }));
  }


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
    const event = [...(project.generationEvents ?? [])].reverse().find((item) =>
      item.provider === "qwen-image" &&
      item.action === "生成关键帧批次" &&
      ["queued", "running", "qa-review"].includes(item.status)
    );
    if (!event) return;

    let cancelled = false;
    const shotIds = new Set((project.generationEvents ?? [])
      .filter((item) => item.runId === event.runId && item.shotId)
      .map((item) => item.shotId!));
    const shots = project.shots.filter((shot) => shotIds.has(shot.id));
    setActiveBatch(shots.length === 1 ? "hero-only" : "all-shots");
    markShotsLoading(shots);
    void pollProjectKeyframes(project.id, event.id, async () => {
      if (!cancelled) await fetchProjectSnapshot().catch(() => undefined);
    }).then(async (completed) => {
      if (cancelled) return;
      setKeyframes((current) => {
        const next = { ...current };
        completed.images.forEach((image) => {
          next[keyframeStorageKey(image)] = image;
        });
        return next;
      });
      await fetchProjectSnapshot().catch(() => undefined);
    }).catch((resumeError) => {
      if (cancelled) return;
      const message = resumeError instanceof Error ? resumeError.message : "关键帧任务恢复失败。";
      setImageBatchError(message);
      markShotsFailed(shots, message);
    }).finally(() => {
      if (!cancelled) setActiveBatch(null);
    });

    return () => {
      cancelled = true;
    };
    // Resume only the task that was present in the server-rendered project snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const renderResponse = await fetch(`/api/projects/${encodeURIComponent(project.id)}/render`, { cache: "no-store" });
        const renderPayload = (await renderResponse.json()) as RenderApiResponse;
        if (cancelled) return;
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

  useEffect(() => {
    void refreshVideoLibrary();
  }, [refreshVideoLibrary]);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-project-section]"));
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const id = visible?.target.getAttribute("data-project-section") as ProjectSectionId | null;
        if (id) setActiveSection(id);
      },
      { rootMargin: "-132px 0px -58% 0px", threshold: [0.05, 0.2, 0.5] }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  function applyProjectSnapshot(data: ProjectApiData) {
    const normalized = normalizeProjectDuration(data.project);
    setDisplayProject(normalized);
    setCurrentVersion(data.version);
    setHeroShotId(normalized.heroShotId ?? undefined);
    setKeyframes(projectKeyframesRecord(normalized));
    return normalized;
  }

  async function fetchProjectSnapshot(apply = true): Promise<ProjectApiData> {
    const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as ProjectApiResponse | null;
    if (!response.ok || !payload?.data) {
      const apiError = payload?.error;
      throw new Error(typeof apiError === "string" ? apiError : apiError?.message || "项目数据刷新失败。");
    }
    if (apply) applyProjectSnapshot(payload.data);
    return payload.data;
  }

  async function handleShotDurationChange(shot: StoryboardShot, rawDuration: number) {
    if (durationSavingShotId) return;
    const durationSec = Math.min(MAX_SHOT_DURATION_SEC, Math.max(MIN_SHOT_DURATION_SEC, Math.round(rawDuration)));
    if (durationSec === shot.durationSec) return;

    const previous = displayProject;
    const optimisticShots = previous.shots.map((item) => item.id === shot.id ? { ...item, durationSec } : item);
    setDisplayProject(normalizeProjectDuration({
      ...previous,
      shots: optimisticShots,
      durationSec: getProjectDurationSec({ shots: optimisticShots })
    }));
    setDurationSavingShotId(shot.id);
    setTimelineError(null);

    try {
      const latest = await fetchProjectSnapshot(false);
      const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: latest.version,
          shotDurations: [{ shotId: shot.id, durationSec }]
        })
      });
      const payload = await response.json().catch(() => null) as ProjectApiResponse | null;
      if (!response.ok || !payload?.data) {
        const apiError = payload?.error;
        const message = typeof apiError === "string" ? apiError : apiError?.message;
        if (response.status === 409) throw new Error("项目已在其他页面更新，已重新载入最新数据。");
        throw new Error(message || "镜头时长保存失败，请重试。");
      }
      const saved = applyProjectSnapshot(payload.data);
      setFinalVideo(null);
      setRenderStatus(saved.finalVideo?.status === "outdated" ? { status: "idle", progress: 0, stage: "时间轴已更新", outputUrl: null, errorMessage: null, warningMessage: "分镜时长已修改，请重新生成最终成片。" } : null);
      if (shot.id === heroShot.id && heroVideo && isGeneratedHeroVideo(heroVideo.source) && heroVideo.durationSec && Math.abs(heroVideo.durationSec - durationSec) > 0.75) {
        setHeroVideoError(`当前视频时长与主镜头设定不一致。主镜头需要 ${durationSec} 秒，现有视频为 ${heroVideo.durationSec.toFixed(1)} 秒。`);
      }
    } catch (saveError) {
      setDisplayProject(previous);
      setTimelineError(saveError instanceof Error ? saveError.message : "镜头时长保存失败，请重试。");
      await fetchProjectSnapshot().catch(() => undefined);
    } finally {
      setDurationSavingShotId(null);
    }
  }

  async function handleRebalanceTimeline() {
    if (timelineRebalancing || !durationDiffersFromTarget) return;
    const shotDurationPlan = allocateShotDurations(displayProject.shots.length, targetDurationSec);
    setTimelineRebalancing(true);
    setTimelineError(null);
    try {
      const latest = await fetchProjectSnapshot(false);
      const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: latest.version,
          shotDurations: displayProject.shots.map((shot, index) => ({
            shotId: shot.id,
            durationSec: shotDurationPlan[index]
          }))
        })
      });
      const payload = await response.json().catch(() => null) as ProjectApiResponse | null;
      if (!response.ok || !payload?.data) {
        const apiError = payload?.error;
        const message = typeof apiError === "string" ? apiError : apiError?.message;
        if (response.status === 409) throw new Error("项目已在其他页面更新，已重新载入最新数据。");
        throw new Error(message || "时间轴重新分配失败，请重试。");
      }
      const saved = applyProjectSnapshot(payload.data);
      setFinalVideo(null);
      setRenderStatus(saved.finalVideo?.status === "outdated"
        ? { status: "idle", progress: 0, stage: "时间轴已重新分配", outputUrl: null, errorMessage: null, warningMessage: "镜头时长已按目标时长重新分配，请重新生成最终成片。" }
        : null);
      const refreshedHeroShot = resolveHeroShot(saved.shots, saved.heroShotId ?? undefined);
      if (refreshedHeroShot && heroVideo && isGeneratedHeroVideo(heroVideo.source) && heroVideo.durationSec && Math.abs(heroVideo.durationSec - refreshedHeroShot.durationSec) > 0.75) {
        setHeroVideoError(`当前视频时长与主镜头设定不一致。主镜头需要 ${refreshedHeroShot.durationSec} 秒，现有视频为 ${heroVideo.durationSec.toFixed(1)} 秒。`);
      }
    } catch (rebalanceError) {
      setTimelineError(rebalanceError instanceof Error ? rebalanceError.message : "时间轴重新分配失败，请重试。");
      await fetchProjectSnapshot().catch(() => undefined);
    } finally {
      setTimelineRebalancing(false);
    }
  }

  async function handleRegenerateShotCount() {
    if (shotCountOperationRef.current || shotCountRegenerating) return;
    const shotCount = clampShotCount(requestedShotCount);
    if (shotCount === displayProject.shots.length) {
      setShotCountDialogOpen(false);
      return;
    }
    shotCountOperationRef.current = true;
    setShotCountRegenerating(true);
    setShotCountElapsedSec(0);
    const operationStartedAt = Date.now();
    const elapsedTimer = window.setInterval(() => {
      setShotCountElapsedSec(Math.max(1, Math.floor((Date.now() - operationStartedAt) / 1_000)));
    }, 1_000);
    setTimelineError(null);
    try {
      await resetGenerationLogForNewRun();
      const targetDurationSec = clampTargetDuration(
        shotCount,
        displayProject.targetDurationSec ?? displayProject.brief.durationSec
      );
      const shotDurationPlan = allocateShotDurations(shotCount, targetDurationSec);
      const response = await fetch("/api/generate-storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: displayProject.id,
          brief: displayProject.brief,
          strategy: displayProject.strategy,
          requestedShotCount: shotCount,
          targetDurationSec,
          shotDurationPlan,
          regenerateExisting: true
        })
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "分镜数量调整失败，请重试。");
      const snapshot = await fetchProjectSnapshot();
      const refreshed = snapshot.project;
      setHeroShotId(refreshed.heroShotId ?? undefined);
      setHeroVideo(null);
      setFinalVideo(null);
      setRenderStatus(null);
      setRequestedShotCount(refreshed.shots.length);
      setShotCountDialogOpen(false);
    } catch (regenerateError) {
      setTimelineError(regenerateError instanceof Error ? regenerateError.message : "分镜数量调整失败，请重试。");
    } finally {
      window.clearInterval(elapsedTimer);
      shotCountOperationRef.current = false;
      setShotCountRegenerating(false);
    }
  }
  async function generateImages(mode: "hero-only" | "all-shots", explicitShots?: StoryboardShot[], frameIds?: string[]) {
    setImageBatchError(null);
    setActiveBatch(mode);
    const targetShots = explicitShots ?? (mode === "hero-only" ? [heroShot] : displayProject.shots);
    markShotsLoading(targetShots, frameIds);

    try {
      await resetGenerationLogForNewRun();
      const completed = await generateProjectKeyframes({
        projectId: displayProject.id,
        shots: targetShots,
        aspectRatio: displayProject.brief.aspectRatio,
        frameIds,
        onProgress: async () => { await fetchProjectSnapshot().catch(() => undefined); }
      });

      setKeyframes((current) => {
        const next = { ...current };
        completed.images.forEach((image) => {
          next[keyframeStorageKey(image)] = image;
        });
        return next;
      });
      await fetchProjectSnapshot().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "关键帧生成失败。";
      setImageBatchError(message);
      markShotsFailed(targetShots, message, frameIds);
    } finally {
      setActiveBatch(null);
    }
  }

  function markShotsLoading(shots: StoryboardShot[], frameIds?: string[]) {
    setKeyframes((current) => {
      const next = { ...current };
      shots.forEach((shot) => {
        const ids = (shot.frames?.map((frame) => frame.id) ?? [shot.id]).filter((id) => !frameIds || frameIds.includes(id));
        ids.forEach((frameId) => { next[frameId] = { ...(next[frameId] ?? { shotId: shot.id, frameId }), status: "loading" }; });
      });
      return next;
    });
  }

  function markShotsFailed(shots: StoryboardShot[], reason: string, frameIds?: string[]) {
    setKeyframes((current) => {
      const next = { ...current };
      shots.forEach((shot) => {
        const ids = (shot.frames?.map((frame) => frame.id) ?? [shot.id]).filter((id) => !frameIds || frameIds.includes(id));
        ids.forEach((frameId) => {
          if (next[frameId]?.imageUrl || next[frameId]?.localUrl) {
            next[frameId] = { ...next[frameId]!, status: "ready" };
          } else {
            next[frameId] = { shotId: shot.id, frameId, status: "failed", fallbackUsed: true, fallbackReason: reason };
          }
        });
      });
      return next;
    });
  }

  async function handleSetHeroShot(shot: StoryboardShot) {
    const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch: { heroShotId: shot.id } })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      setHeroVideoError(payload?.error?.message || "主镜头保存失败，请重试。");
      return;
    }

    setHeroShotId(shot.id);
    setHeroVideo(null);
    setHeroVideoError(null);
    setWaitingManualUpload(false);
    setFallbackToKeyframe(false);
    setDisplayProject(setProjectHeroShot(displayProject, shot));
    await deleteStoredHeroVideo(displayProject.id);
  }

  async function copyPrompt(kind: "raw" | "optimized", value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedPrompt(kind);
    setWaitingManualUpload(false);
    setFallbackToKeyframe(false);
    window.setTimeout(() => setCopiedPrompt(null), 1200);
  }

  async function handleGenerateWanVideo() {
    setHeroVideoError(null);
    setHeroVideoGenerating(true);
    setHeroVideoElapsedSec(0);
    setWaitingManualUpload(false);
    setFallbackToKeyframe(false);

    try {
      const heroReference = primaryShotKeyframe(heroShot, keyframes);
      const heroReferenceUrl = heroReference?.localUrl || heroReference?.imageUrl;
      if (!heroReferenceUrl) {
        throw new Error("Wan 2.7 I2V 需要当前主镜头关键帧作为唯一首帧。请先重新生成当前主镜头关键帧。");
      }
      if (!(displayProject.brief.productImages ?? []).some((image) => image.role !== "logo" && (image.localUrl || image.remoteUrl || image.url))) {
        throw new Error("生成 Wan 2.7 I2V 首帧前需要至少一张已保存的真实产品图。请先返回生成页上传产品主图。");
      }
      await resetGenerationLogForNewRun();
      const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/wan-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shotId: heroShot.id,
          imageUrl: heroReferenceUrl,
          productImages: displayProject.brief.productImages ?? [],
          prompt: optimizedVideoPrompt,
          aspectRatio: displayProject.brief.aspectRatio,
          durationSec: Math.min(8, Math.max(3, Math.round(heroShot.durationSec || 5)))
        })
      });
      const payload = await readClientApiResponse<NonNullable<HeroVideoAssetResponse["data"]>>(response);
      if (!payload.success || !payload.data) {
        throw new Error(payload.error || "Wan 2.7 API 调用失败，请检查百炼 Key、模型权限和账户额度。");
      }
      const completed = payload.data.asset
        ? payload.data
        : await pollProjectWanVideoUntilComplete(
            displayProject.id,
            payload.data.eventId,
            setHeroVideoElapsedSec
          );
      if (!completed.asset) throw new Error("Wan 2.7 任务已结束，但没有取得项目视频资产。");
      setHeroVideo(heroVideoFromAsset(completed.asset));
      await refreshVideoLibrary();
    } catch (error) {
      setHeroVideoError(error instanceof Error ? error.message : "Wan 2.7 API 调用失败。");
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
      if (!response.ok || !payload.success || !payload.data?.asset) throw new Error(payload.error || "广告视频上传失败。");
      setHeroVideo(heroVideoFromAsset(payload.data.asset));
      setWaitingManualUpload(false);
      setFallbackToKeyframe(false);
      await refreshVideoLibrary();
    } catch (error) {
      setHeroVideoError(error instanceof Error ? error.message : "广告视频上传失败。");
    } finally {
      setHeroVideoUploading(false);
    }
  }

  async function clearHeroVideo() {
    setHeroVideo(null);
    setHeroVideoError(null);
    setWaitingManualUpload(false);
    setFallbackToKeyframe(false);
    await deleteStoredHeroVideo(displayProject.id);
    await refreshVideoLibrary();
  }

  async function startFinalRender() {
    setRenderError(null);
    if (!heroVideo) {
      setRenderError("请先生成或导入广告视频，再生成最终 MP4。");
      return;
    }

    setRenderStatus({ status: "validating", progress: 0.02, stage: "正在校验成片素材", outputUrl: null, errorMessage: null });
    try {
      await resetGenerationLogForNewRun();
      const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: { ...displayProject, heroShotId },
          keyframes
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

  async function refreshFinalVideo() {
    const response = await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}/final-video`, { cache: "no-store" });
    const payload = (await response.json()) as FinalVideoApiResponse;
    if (payload.success && payload.data?.outputUrl) {
      setFinalVideo({
        outputUrl: payload.data.outputUrl,
        downloadUrl: payload.data.downloadUrl || payload.data.outputUrl,
        sizeBytes: payload.data.sizeBytes
      });
    }
    await refreshVideoLibrary();
  }

  function scrollToSection(sectionId: ProjectSectionId) {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    document.getElementById(`project-${sectionId}`)?.scrollIntoView({ behavior, block: "start" });
  }

  async function handlePrimaryAction() {
    if (nextAction.kind === "keyframes") {
      await generateImages("all-shots", missingKeyframeShots);
      return;
    }
    if (nextAction.kind === "render" && heroVideo && !renderIsActive) {
      await startFinalRender();
      return;
    }
    scrollToSection(nextAction.section);
  }

  function openShotDetails(shot: StoryboardShot, tab: ShotDetailsTab = "image") {
    setDetailsShotId(shot.id);
    setDetailsTab(tab);
  }

  function updateShot(shotId: string, patch: Partial<StoryboardShot>) {
    setDisplayProject((current) => ({
      ...current,
      shots: current.shots.map((shot) => shot.id === shotId ? { ...shot, ...patch } : shot)
    }));
  }

  async function closeShotDetails() {
    setDetailsShotId(null);
    await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch: { shots: displayProject.shots } })
    }).catch(() => undefined);
  }

  return (
    <main className="project-detail-v4 project-v3 min-h-screen text-white">
      <CinematicWorkspaceBackground />
      <WorkspaceHeader active="项目" workbenchHref={`/generate?projectId=${encodeURIComponent(projectId)}`} projectHref={`/projects/${encodeURIComponent(projectId)}`} trailing={<AIModeBadge status={aiStatus} />} />

      <div className="project-detail-v4__shell">
        <header className="project-header-v4">
          <nav className="project-breadcrumb-v4" aria-label="面包屑">
            <Link href={`/generate?projectId=${encodeURIComponent(projectId)}`}>项目</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{displayProject.brief.productName}</span>
          </nav>

          <div className="project-header-v4__main">
            <div className="project-header-v4__copy">
              <h1>{displayProject.brief.productName}</h1>
              <p>从关键帧到最终成片。</p>
            </div>
            <div className="project-header-v4__actions">
              <button
                type="button"
                className="project-button-v4 project-button-v4--primary"
                disabled={activeBatch !== null || renderIsActive}
                aria-busy={activeBatch !== null || renderIsActive}
                onClick={() => void handlePrimaryAction()}
              >
                {activeBatch ? "关键帧生成中" : renderIsActive ? "成片生成中" : nextAction.label}
              </button>
              <Link className="project-button-v4 project-button-v4--secondary" href={`/generate?projectId=${encodeURIComponent(projectId)}`}>项目设置</Link>
            </div>
          </div>

          <dl className="project-meta-v4" aria-label="项目元信息">
            <MetaItem label="品类" value={displayProject.brief.category} />
            <MetaItem label={durationDiffersFromTarget ? "当前时长" : "时长"} value={`${projectDurationSec} 秒`} />
            {durationDiffersFromTarget ? <MetaItem label="原计划" value={`${targetDurationSec} 秒`} /> : null}
            <MetaItem label="画幅" value={displayProject.brief.aspectRatio} />
            <MetaItem label="更新" value={formatUpdatedAt(displayProject.updatedAt)} />
          </dl>
          {durationDiffersFromTarget ? (
            <div className="project-duration-rebalance-v4">
              <span>镜头时长已偏离原计划。</span>
              <button type="button" disabled={timelineRebalancing || Boolean(durationSavingShotId)} onClick={() => void handleRebalanceTimeline()}>
                {timelineRebalancing ? "重新分配中" : "按目标时长重新分配"}
              </button>
            </div>
          ) : null}
        </header>

        <ProjectWorkflow steps={projectSteps} />

        <nav className="project-anchor-nav-v4" aria-label="项目章节">
          {projectAnchorItems.map((item) => (
            <a key={item.id} className={activeSection === item.id ? "is-active" : ""} href={`#project-${item.id}`} aria-current={activeSection === item.id ? "location" : undefined} onClick={(event) => { event.preventDefault(); scrollToSection(item.id); }}>{item.label}</a>
          ))}
        </nav>

        <section id="project-overview" data-project-section="overview" className="project-overview-v4" aria-labelledby="project-overview-title">
          <h2 id="project-overview-title" className="sr-only">项目概览</h2>
          <article className="project-media-card-v4">
            <header><span>项目媒体</span><strong>{displayProject.brief.aspectRatio}</strong></header>
            {heroVideo?.url || productMediaUrl || heroFrameUrl ? <AdaptiveMediaFrame
              aspectRatio={displayProject.brief.aspectRatio}
              stage="overview"
              mediaType={heroVideo ? "video" : "image"}
              src={heroVideo?.url || productMediaUrl || heroFrameUrl}
              controls={Boolean(heroVideo)}
              fit="contain"
              showBlurredBackdrop={false}
              alt={heroVideo ? `${displayProject.brief.productName} 导入广告视频` : `${displayProject.brief.productName} 产品或主镜头预览`}
            /> : <VisualAssetPlaceholder title="预览待生成" description="完成对应生成步骤后，这里将显示预览。" aspectRatio={displayProject.brief.aspectRatio} />}
            <footer><span>{heroVideo ? "导入广告视频" : productMediaUrl ? "真实产品素材" : "主镜头关键帧"}</span><strong>{heroVideo || productMediaUrl || heroFrameUrl ? "媒体已就绪" : "等待生成"}</strong></footer>
          </article>

          <article className="strategy-card-v4">
            <small>核心创意</small>
            <h2>{displayProject.strategy.coreMessage}</h2>
            <div className="strategy-card-v4__facts">
              <InfoCard label="目标用户" value={displayProject.strategy.audienceInsight || displayProject.brief.targetAudience} />
              <InfoCard label="情绪钩子" value={displayProject.strategy.emotionalHook} />
              <InfoCard label="行动引导" value={displayProject.strategy.cta} />
            </div>
            <div className="strategy-card-v4__tags">
              <span>{displayProject.brief.productName}</span>
              <span>{displayProject.brief.category}</span>
              <span>{projectDurationSec} 秒</span>
            </div>
          </article>
        </section>

        <section className="model-route-v4" aria-label="模型路由流程">
          <span className="model-route-v4__label">模型路由</span>
          <div className="model-route-v4__nodes">
            {routeNodes().map((node, index) => (
              <div className={`model-route-node-v4 is-${node.tone}`} key={node.name}>
                <i aria-hidden="true" />
                <span><strong>{node.name}</strong><small>{node.detail}</small></span>
                {index < routeNodes().length - 1 ? <b aria-hidden="true">→</b> : null}
              </div>
            ))}
          </div>
        </section>

        {imageBatchError ? <p className="project-notice-v4 is-warning" role="status">{imageBatchError}</p> : null}
        {timelineError ? <p className="project-notice-v4 is-warning" role="alert">{timelineError}</p> : null}

        <section id="project-keyframes" data-project-section="keyframes" className="project-section-v4 keyframe-section-v4" aria-labelledby="project-keyframes-title">
          <header className="project-section-heading-v4">
            <div><small>关键帧</small><h2 id="project-keyframes-title">{displayProject.shots.length} 镜头 · {totalKeyframeCount} 张独立帧 · 共 {projectDurationSec} 秒</h2><p>已完成 {completedKeyframeCount} / {totalKeyframeCount} 帧</p></div>
            <div className="project-section-heading-v4__actions">
              <button type="button" className="project-button-v4 project-button-v4--ghost" onClick={() => { setRequestedShotCount(Math.max(MIN_SHOT_COUNT, Math.min(MAX_SHOT_COUNT, displayProject.shots.length))); setShotCountDialogOpen(true); }}>调整分镜数量</button>
              {missingKeyframeShots.length > 0 ? <button type="button" className="project-button-v4 project-button-v4--ai" disabled={activeBatch !== null} onClick={() => void generateImages("all-shots", missingKeyframeShots)}>生成缺失关键帧</button> : null}
              <button type="button" className="project-button-v4 project-button-v4--secondary" disabled={activeBatch !== null} onClick={() => void generateImages("all-shots")}>重新生成全部</button>
            </div>
          </header>

          <div className="keyframe-grid-v4">
            {displayProject.shots.map((shot) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                aspectRatio={displayProject.brief.aspectRatio}
                keyframes={shotKeyframes(shot, keyframes)}
                isHeroShot={Boolean(displayProject.heroShotId) && shot.id === heroShot.id}
                onGenerate={(frameId) => void generateSingleShot(shot, frameId)}
                onToggleLock={(frame) => void toggleFrameLock(shot, frame)}
                onSetHero={() => void handleSetHeroShot(shot)}
                onDurationChange={(duration) => void handleShotDurationChange(shot, duration)}
                durationSaving={durationSavingShotId === shot.id}
                onOpenDetails={(tab) => openShotDetails(shot, tab)}
              />
            ))}
          </div>
        </section>

        <section id="project-hero-shot" data-project-section="hero-shot" className="project-section-v4 hero-section-v4" aria-labelledby="project-hero-title">
          <header className="project-section-heading-v4">
            <div><small>广告视频</small><h2 id="project-hero-title">Wan 2.7 广告视频</h2><p>根据主镜头关键帧与真实产品图生成，也可以从页面底部的视频库导入完整 MP4。</p></div>
          </header>

          <div className="hero-layout-v4">
            <article className="hero-media-v4">
              <span className="hero-media-v4__badge">当前视频</span>
              {heroVideo?.url || heroFrameUrl ? <AdaptiveMediaFrame
                aspectRatio={displayProject.brief.aspectRatio}
                stage="hero"
                mediaType={heroVideo ? "video" : "image"}
                src={heroVideo?.url || heroFrameUrl}
                controls={Boolean(heroVideo)}
                fit="contain"
                showBlurredBackdrop={false}
                alt={`镜头 ${heroShot.index}：${heroShot.subtitle}`}
              /> : <VisualAssetPlaceholder title="预览待生成" description="完成对应生成步骤后，这里将显示预览。" aspectRatio={displayProject.brief.aspectRatio} />}
              <div><strong>镜头 {heroShot.index}</strong><h3>{heroShot.subtitle}</h3><p>{heroShot.goal}</p></div>
            </article>

            <article className="hero-workflow-v4">
              <div className="hero-status-v4"><i aria-hidden="true" /><div><span>广告视频状态</span><strong>{heroStatusLabel(heroVideoStatus)}</strong><p>{heroStatusMessage(heroVideoStatus)}</p></div></div>
              <div className="hero-manual-copy-v4"><strong>Wan 2.7 单首帧生成</strong><p>真实产品图已融合进当前关键帧；Wan 只接收这一张完整首帧，避免拼贴和分栏画面。</p></div>

              <div className="hero-prompts-v4">
                <PromptSummary title="中文视频提示词" body={optimizedVideoPrompt} copied={copiedPrompt === "optimized"} onCopy={() => void copyPrompt("optimized", optimizedVideoPrompt)} />
                <PromptSummary title="英文画面约束" body={heroShot.imagePromptEn} copied={false} onCopy={() => void navigator.clipboard.writeText(heroShot.imagePromptEn)} />
              </div>

              <div className="hero-workflow-v4__actions">
                <button type="button" className="project-button-v4 project-button-v4--primary" disabled={heroVideoGenerating || heroVideoUploading} aria-busy={heroVideoGenerating} onClick={() => void handleGenerateWanVideo()}>{heroVideoGenerating ? `Wan 2.7 生成中 · ${heroVideoElapsedSec} 秒` : heroVideo?.source === "wan-api" ? "重新生成广告视频" : "调用 Wan 2.7 生成"}</button>
                <button type="button" className="project-button-v4 project-button-v4--ai" onClick={() => void copyPrompt("optimized", optimizedVideoPrompt)}>{copiedPrompt === "optimized" ? "提示词已复制" : "复制 Wan 2.7 提示词"}</button>
                <button type="button" className="project-button-v4 project-button-v4--ghost" onClick={() => openShotDetails(heroShot, "video")}>查看生成详情</button>
              </div>

              <details className="hero-fallback-v4">
                <summary>备用方式</summary>
                <div>
                  {heroVideo ? <button type="button" className="is-danger" onClick={() => void clearHeroVideo()}>从当前项目移除</button> : <button type="button" onClick={() => { setHeroVideo(null); setFallbackToKeyframe(true); }}>使用关键帧降级</button>}
                </div>
              </details>
              {heroVideo ? <HeroVideoMeta video={heroVideo} /> : null}
              {heroVideoError ? <p className="project-notice-v4 is-warning" role="alert">{heroVideoError}</p> : null}
            </article>
          </div>

        </section>

        <section id="project-final" data-project-section="final" className="project-section-v4 render-section-v4" aria-labelledby="project-final-title">
          <header className="project-section-heading-v4">
            <div><small>成片合成</small><h2 id="project-final-title">Remotion 成片合成</h2></div>
          </header>

          <div className="render-layout-v4">
            <div className="render-readiness-v4">
              <ReadinessItem label="关键帧" value={`${completedKeyframeCount} / ${displayProject.shots.length} 已准备`} tone={completedKeyframeCount === displayProject.shots.length ? "success" : "warning"} />
              <ReadinessItem label="主镜头" value={`镜头 ${heroShot.index} 已选择`} tone="success" />
              <ReadinessItem label="广告视频" value={heroVideo ? "已就绪" : "待导入"} tone={heroVideo ? "success" : "blocked"} />
              <ReadinessItem label="时间轴" value={`${projectDurationSec} 秒`} tone="success" />
            </div>

            <div className="render-control-v4">
              {finalVideo ? (
                <AdaptiveMediaFrame aspectRatio={displayProject.brief.aspectRatio} stage="main" mediaType="video" src={finalVideo.outputUrl} controls fit="contain" showBlurredBackdrop={false} alt={`${displayProject.brief.productName} 最终成片`} />
              ) : (
                <div className="render-control-v4__summary"><span>成片状态</span><strong>{renderStatusLabel(renderStatus)}</strong><p>{finalRenderCopy(renderStatus, heroVideo, projectDurationSec, displayProject.shots.length)}</p></div>
              )}

              <div className="render-control-v4__actions">
                <button type="button" className={`project-button-v4 ${heroVideo && allKeyframesReady ? "project-button-v4--primary" : "project-button-v4--ai"}`} disabled={!heroVideo || !allKeyframesReady || renderIsActive} aria-describedby={!heroVideo || !allKeyframesReady ? "render-blocked-reason" : undefined} onClick={() => void startFinalRender()}>{renderIsActive ? "成片生成中" : renderStatus?.status === "failed" ? "重新生成成片" : "生成最终成片"}</button>
                {renderIsActive ? <button type="button" className="project-button-v4 project-button-v4--secondary" onClick={() => void cancelFinalRender()}>取消任务</button> : null}
                {finalVideo ? <Link className="project-button-v4 project-button-v4--secondary" href={finalVideo.downloadUrl}>下载 MP4</Link> : null}
              </div>
              {!heroVideo || !allKeyframesReady ? <p id="render-blocked-reason" className="render-blocked-v4">{!heroVideo ? "生成或导入广告视频后即可生成最终成片。" : "所有关键帧通过一致性检查后才可生成最终成片。"}</p> : null}
              {renderStatus ? <RenderProgress status={renderStatus} /> : null}
              {renderStatus?.warningMessage ? <p className="project-notice-v4 is-warning">{renderStatus.warningMessage}</p> : null}
              {renderError ? <p className="project-notice-v4 is-warning" role="alert">{renderError}</p> : null}
            </div>
          </div>
        </section>

        <section className="video-library-v4" aria-labelledby="video-library-title">
          <header className="video-library-v4__header">
            <div><h2 id="video-library-title">视频库</h2><p>当前会话内生成和上传的视频会集中保留，并在所有项目中可见；本地 MP4 不限制原视频时长和比例。</p></div>
            <label className="project-button-v4 project-button-v4--secondary">
              {heroVideoUploading ? "视频导入中" : "导入完整广告视频"}
              <input className="sr-only" type="file" accept="video/mp4" disabled={heroVideoUploading || heroVideoGenerating} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleHeroVideoUpload(file); event.target.value = ""; }} />
            </label>
          </header>
          {videoLibraryLoading ? <div className="video-library-v4__empty">正在读取视频库…</div> : null}
          {!videoLibraryLoading && videoLibrary.length === 0 ? <div className="video-library-v4__empty">还没有历史视频，可以从这里导入完整 MP4，或调用 Wan 2.7 生成。</div> : null}
          {videoLibrary.length > 0 ? (
            <div className="video-library-v4__grid">
              {videoLibrary.map((video) => (
                <article className="video-library-card-v4" key={`${video.projectId}-${video.id}`}>
                  <AdaptiveMediaFrame aspectRatio={displayProject.brief.aspectRatio} stage="hero" mediaType="video" src={video.url} controls fit="contain" showBlurredBackdrop={false} alt={`${video.projectName} ${videoLibrarySourceLabel(video)}`} />
                  <div className="video-library-card-v4__body">
                    <div><span>{videoLibrarySourceLabel(video)}</span><strong>{video.fileName}</strong></div>
                    <p>{video.projectName}{video.durationSec ? ` · ${formatDuration(video.durationSec)}` : ""}{video.width && video.height ? ` · ${video.width}×${video.height}` : ""}</p>
                    <a className="project-button-v4 project-button-v4--ghost" href={video.downloadUrl}>下载</a>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {videoLibraryError ? <p className="project-notice-v4 is-warning" role="alert">{videoLibraryError}</p> : null}
        </section>
      </div>

      {shotCountDialogOpen ? (
        <div className="shot-count-dialog-v4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !shotCountRegenerating) setShotCountDialogOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="shot-count-dialog-title">
            <header><div><small>调整分镜数量</small><h2 id="shot-count-dialog-title">重新生成完整分镜</h2></div><button type="button" aria-label="关闭" disabled={shotCountRegenerating} onClick={() => setShotCountDialogOpen(false)}>×</button></header>
            <div className="shot-count-dialog-v4__summary">
              <span>当前</span><strong>{displayProject.shots.length} 个镜头 · {projectDurationSec} 秒</strong>
            </div>
            <ShotCountDialogControl value={requestedShotCount} disabled={shotCountRegenerating} onChange={setRequestedShotCount} />
            <p>修改分镜数量将重新生成整套分镜，并使现有关键帧、导入广告视频和最终成片失效。此操作不会修改广告需求和核心策略。</p>
            {shotCountRegenerating ? <p className="shot-count-dialog-v4__progress" aria-live="polite">正在请求 DeepSeek；20 秒未响应时会自动使用当前数量与时长的本地分镜继续。已等待 {shotCountElapsedSec} 秒。</p> : null}
            <footer>
              <button type="button" className="project-button-v4 project-button-v4--secondary" disabled={shotCountRegenerating} onClick={() => setShotCountDialogOpen(false)}>取消</button>
              <button type="button" className="project-button-v4 project-button-v4--primary" disabled={shotCountRegenerating || requestedShotCount === displayProject.shots.length} onClick={() => void handleRegenerateShotCount()}>{shotCountRegenerating ? `重新生成中 · ${shotCountElapsedSec} 秒` : "确认并重新生成"}</button>
            </footer>
          </section>
        </div>
      ) : null}
      <ShotDetailsSheet
        shot={detailsShot}
        keyframe={detailsShot ? primaryShotKeyframe(detailsShot, keyframes) : undefined}
        project={displayProject}
        initialTab={detailsTab}
        onClose={() => void closeShotDetails()}
        onUpdateShot={updateShot}
      />
    </main>
  );

  async function generateSingleShot(shot: StoryboardShot, frameId?: string) {
    await generateImages("all-shots", [shot], frameId ? [frameId] : undefined);
  }

  async function toggleFrameLock(shot: StoryboardShot, frame: ShotFrame) {
    const frames = (shot.frames ?? []).map((item) => item.id === frame.id ? { ...item, isLocked: !item.isLocked } : item);
    updateShot(shot.id, { frames });
    await fetch(`/api/projects/${encodeURIComponent(displayProject.id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch: { shots: displayProject.shots.map((item) => item.id === shot.id ? { ...item, frames } : item) } })
    }).catch(() => undefined);
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
  return ["queued", "validating", "narrating", "bundling", "rendering", "encoding"].includes(status);
}

async function pollProjectWanVideoUntilComplete(
  projectId: string,
  eventId: string | undefined,
  onProgress: (elapsedSeconds: number) => void
): Promise<NonNullable<HeroVideoAssetResponse["data"]>> {
  if (!eventId) throw new Error("Wan 2.7 已接受请求，但没有返回任务事件 ID。");
  const intervalMs = 5_000;
  const maxAttempts = 120;
  let consecutiveTransportErrors = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
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

    const result = await readClientApiResponse<NonNullable<HeroVideoAssetResponse["data"]>>(response);
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

  throw new Error("Wan 2.7 已等待 10 分钟仍未完成。任务可能仍在百炼处理中，请稍后刷新项目继续查看。");
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

const projectAnchorItems: Array<{ id: ProjectSectionId; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "keyframes", label: "关键帧" },
  { id: "hero-shot", label: "广告视频" },
  { id: "final", label: "成片合成" }
];

function ShotCountDialogControl({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <div className="shot-count-dialog-v4__control">
      <span>调整为</span>
      <div>
        <button type="button" aria-label="减少分镜数量" disabled={disabled || value <= MIN_SHOT_COUNT} onClick={() => onChange(clampShotCount(value - 1))}>−</button>
        <input aria-label="新的分镜数量" type="number" min={MIN_SHOT_COUNT} max={MAX_SHOT_COUNT} value={value} disabled={disabled} onChange={(event) => onChange(clampShotCount(Number.parseInt(event.target.value, 10) || value))} />
        <button type="button" aria-label="增加分镜数量" disabled={disabled || value >= MAX_SHOT_COUNT} onClick={() => onChange(clampShotCount(value + 1))}>+</button>
      </div>
      <strong>{value} 个镜头 · 初始约 {value * DEFAULT_SHOT_DURATION_SEC} 秒</strong>
    </div>
  );
}

function ShotDurationControl({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (duration: number) => void }) {
  return (
    <span className="shot-duration-control-v4" aria-label={`当前镜头时长 ${value} 秒`}>
      <button type="button" aria-label="减少镜头时长" disabled={disabled || value <= MIN_SHOT_DURATION_SEC} onClick={() => onChange(value - 1)}>−</button>
      <em>{disabled ? "保存中" : `${value} 秒`}</em>
      <button type="button" aria-label="增加镜头时长" disabled={disabled || value >= MAX_SHOT_DURATION_SEC} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}
function ProjectWorkflow({ steps }: { steps: ProjectWorkflowStep[] }) {
  return (
    <section className="project-workflow-v4" aria-label="项目工作流状态">
      <ol>
        {steps.map((step, index) => (
          <li className={`is-${step.status}`} key={step.id}>
            <div className="project-workflow-v4__rail" aria-hidden="true">
              <span className="project-workflow-v4__node">{workflowStatusMark(step.status)}</span>
              {index < steps.length - 1 ? <i /> : null}
            </div>
            <strong>{step.label}</strong>
            <small>{workflowStatusLabel(step.status)} · {step.detail}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ShotCard({
  shot,
  keyframes,
  aspectRatio,
  isHeroShot,
  onGenerate,
  onSetHero,
  onDurationChange,
  durationSaving,
  onOpenDetails,
  onToggleLock
}: {
  shot: StoryboardShot;
  keyframes: KeyframeResult[];
  aspectRatio: AspectRatio;
  isHeroShot: boolean;
  onGenerate: (frameId?: string) => void;
  onSetHero: () => void;
  onDurationChange: (duration: number) => void;
  durationSaving: boolean;
  onOpenDetails: (tab?: ShotDetailsTab) => void;
  onToggleLock: (frame: ShotFrame) => void;
}) {
  const frames = shot.frames ?? [];
  const [currentIndex, setCurrentIndex] = useState(0);
  const safeIndex = Math.min(Math.max(0, currentIndex), Math.max(0, frames.length - 1));
  const currentFrame = frames[safeIndex];
  const keyframe = currentFrame
    ? keyframes.find((item) => item.frameId === currentFrame.id)
    : keyframes[0];
  const imageUrl = keyframe?.fallbackUsed ? undefined : keyframe?.localUrl || keyframe?.imageUrl;
  const status = keyframeCardStatus(keyframe);
  const isLoading = keyframe?.status === "loading" || keyframe?.status === "generated" || keyframe?.status === "qa-review";
  const frameCount = Math.max(1, frames.length);
  const goPrevious = () => setCurrentIndex((value) => (value - 1 + frameCount) % frameCount);
  const goNext = () => setCurrentIndex((value) => (value + 1) % frameCount);
  return (
    <article
      className={`keyframe-card-v4${isHeroShot ? " is-hero" : ""}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); goPrevious(); }
        if (event.key === "ArrowRight") { event.preventDefault(); goNext(); }
      }}
      aria-label={`镜头 ${shot.index} 帧轮播`}
    >
      <div className="keyframe-card-v4__media">
        {imageUrl ? <AdaptiveMediaFrame
          aspectRatio={aspectRatio}
          stage="keyframe"
          mediaType="image"
          src={imageUrl}
          fit="contain"
          showBlurredBackdrop={false}
          alt={`镜头 ${shot.index} 第 ${safeIndex + 1} 帧：${currentFrame?.description ?? shot.subtitle}`}
        /> : <VisualAssetPlaceholder title="关键帧待生成" description="当前镜头还没有关键帧。" aspectRatio={aspectRatio} status={isLoading ? "running" : keyframe?.status === "failed" ? "failed" : "pending"} actionLabel="生成关键帧" onAction={() => onGenerate(currentFrame?.id)} />}
        <div className="keyframe-card-v4__badges">
          {isHeroShot ? <span className="is-hero">当前主镜头</span> : null}
          {shot.exactProductShot ? <span>精确产品镜头</span> : shot.containsProduct ? <span>产品互动镜头</span> : null}
          <span className={`is-${status}`}>{keyframeStatusLabel(status)}</span>
        </div>
        {frameCount > 1 ? <div className="keyframe-card-v4__carousel" aria-label="帧导航">
          <button type="button" onClick={goPrevious} aria-label="上一帧" title="上一帧">‹</button>
          <span>{safeIndex + 1}/{frameCount}</span>
          <button type="button" onClick={goNext} aria-label="下一帧" title="下一帧">›</button>
        </div> : null}
      </div>

      <div className="keyframe-card-v4__content">
        <header>
          <div><span>镜头 {shot.index}</span>{currentFrame ? <em>{shotFrameRoleLabel(currentFrame.role)}</em> : null}<ShotDurationControl value={shot.durationSec} disabled={durationSaving} onChange={onDurationChange} /></div>
          <button type="button" className="keyframe-card-v4__details" onClick={() => onOpenDetails()}>生成详情</button>
        </header>
        <h3>{shot.subtitle}</h3>
        <p>{currentFrame?.description ?? shot.visualDescription}</p>
        <div className="keyframe-card-v4__pills" aria-label="镜头参数">
          {[shot.cameraAngle, shot.cameraMovement, aspectRatio].filter(Boolean).slice(0, 3).map((value) => <span key={value}>{value}</span>)}
        </div>
        {keyframe?.fallbackUsed ? <span className="keyframe-card-v4__fallback"><i aria-hidden="true" />已使用本地降级图</span> : null}
        <div className="keyframe-card-v4__actions">
          <button type="button" className="project-button-v4 project-button-v4--ai" disabled={isLoading || currentFrame?.isLocked} aria-busy={isLoading} onClick={() => onGenerate(currentFrame?.id)}>
            {isLoading ? "生成中" : currentFrame?.isLocked ? "当前帧已锁定" : keyframe?.status === "ready" && !keyframe.fallbackUsed ? "重生当前帧" : "生成当前帧"}
          </button>
          {currentFrame ? <button type="button" className="project-button-v4 project-button-v4--secondary" onClick={() => onToggleLock(currentFrame)}>{currentFrame.isLocked ? "解锁当前帧" : "锁定当前帧"}</button> : null}
          {isHeroShot
            ? <span className="keyframe-card-v4__hero-state">已选为主镜头</span>
            : <button type="button" className="project-button-v4 project-button-v4--secondary" onClick={onSetHero}>设为主镜头</button>}
        </div>
      </div>
    </article>
  );
}

function PromptSummary({ title, body, copied, onCopy }: { title: string; body: string; copied: boolean; onCopy: () => void }) {
  return (
    <article className="prompt-summary-v4">
      <header><h3>{title}</h3><button type="button" onClick={onCopy}>{copied ? "已复制" : "复制"}</button></header>
      <p>{body}</p>
      <details>
        <summary>展开完整提示词</summary>
        <div>{body}</div>
      </details>
    </article>
  );
}

function ReadinessItem({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "blocked" | "pending" }) {
  return <div className={`readiness-item-v4 is-${tone}`}><i aria-hidden="true" /><span>{label}</span><strong>{value}</strong></div>;
}

function isUsableKeyframe(keyframe?: KeyframeResult) {
  return Boolean(
    keyframe
    && keyframe.status === "ready"
    && !keyframe.fallbackUsed
    && (keyframe.localUrl || keyframe.imageUrl)
  );
}

function keyframeStorageKey(keyframe: Pick<KeyframeResult, "shotId" | "frameId">) {
  return keyframe.frameId ?? keyframe.shotId;
}

function shotKeyframes(shot: StoryboardShot, keyframes: Record<string, KeyframeResult>) {
  if (!shot.frames?.length) return keyframes[shot.id] ? [keyframes[shot.id]] : [];
  return shot.frames.flatMap((frame) => keyframes[frame.id] ? [keyframes[frame.id]!] : []);
}

function primaryShotKeyframe(shot: StoryboardShot, keyframes: Record<string, KeyframeResult>) {
  return shotKeyframes(shot, keyframes).find(isUsableKeyframe) ?? shotKeyframes(shot, keyframes)[0];
}

function isShotKeyframesComplete(shot: StoryboardShot, keyframes: Record<string, KeyframeResult>) {
  if (!shot.frames?.length) return isUsableKeyframe(keyframes[shot.id]);
  return shot.frames.every((frame) => isUsableKeyframe(keyframes[frame.id]));
}

function shotFrameRoleLabel(role: ShotFrame["role"]) {
  return ({ start: "起始", setup: "铺垫", action: "动作", product: "产品", reaction: "反应", transition: "转场", end: "结果" } as const)[role];
}

type KeyframeCardStatus = "completed" | "running" | "qa-review" | "needs-review" | "pending" | "fallback";

function keyframeCardStatus(keyframe?: KeyframeResult): KeyframeCardStatus {
  if (keyframe?.status === "loading") return "running";
  if (keyframe?.status === "generated" || keyframe?.status === "qa-review") return "qa-review";
  if (keyframe?.status === "needs-review") return "needs-review";
  if (isUsableKeyframe(keyframe)) return "completed";
  if (keyframe?.status === "failed" || keyframe?.fallbackUsed) return "fallback";
  return "pending";
}

function keyframeStatusLabel(status: KeyframeCardStatus) {
  const labels: Record<KeyframeCardStatus, string> = {
    completed: "可用",
    running: "生成中",
    "qa-review": "一致性检查",
    "needs-review": "需人工确认",
    pending: "待生成",
    fallback: "已降级"
  };
  return labels[status];
}

function workflowStatusMark(status: ProjectStepStatus) {
  const marks: Record<ProjectStepStatus, string> = {
    completed: "✓",
    running: "•",
    "qa-review": "•",
    "needs-review": "!",
    pending: "○",
    failed: "!",
    fallback: "↘",
    blocked: "—"
  };
  return marks[status];
}

function workflowStatusLabel(status: ProjectStepStatus) {
  const labels: Record<ProjectStepStatus, string> = {
    completed: "已完成",
    running: "进行中",
    "qa-review": "一致性检查",
    "needs-review": "需人工确认",
    pending: "待开始",
    failed: "失败",
    fallback: "已降级",
    blocked: "待解锁"
  };
  return labels[status];
}

function normalizeWorkflowStatus(status: string | undefined): ProjectStepStatus {
  if (status === "completed" || status === "running" || status === "qa-review" || status === "needs-review" || status === "failed" || status === "fallback" || status === "blocked") return status;
  return "pending";
}

function buildProjectSteps({
  project,
  keyframes,
  activeBatch,
  imageBatchError,
  heroVideo,
  heroVideoUploading,
  heroVideoError,
  fallbackToKeyframe,
  renderStatus,
  finalVideo
}: {
  project: GenerationProject;
  keyframes: Record<string, KeyframeResult>;
  activeBatch: "hero-only" | "all-shots" | null;
  imageBatchError: string | null;
  heroVideo: HeroVideoState | null;
  heroVideoUploading: boolean;
  heroVideoError: string | null;
  fallbackToKeyframe: boolean;
  renderStatus: RenderStatusState | null;
  finalVideo: { outputUrl: string; downloadUrl: string; sizeBytes: number } | null;
}): ProjectWorkflowStep[] {
  const completedFrames = project.shots.filter((shot) => isShotKeyframesComplete(shot, keyframes)).length;
  const fallbackFrames = project.shots.filter((shot) => shotKeyframes(shot, keyframes).some((frame) => frame.fallbackUsed || frame.status === "failed")).length;
  const keyframeStatus: ProjectStepStatus = activeBatch
    ? "running"
    : completedFrames === project.shots.length
      ? "completed"
      : fallbackFrames > 0
        ? "fallback"
        : imageBatchError
          ? "failed"
          : normalizeWorkflowStatus(project.workflowSteps?.keyframes);
  const heroStatus: ProjectStepStatus = project.heroShotId ? "completed" : keyframeStatus === "completed" ? "pending" : "blocked";
  const videoStatus: ProjectStepStatus = heroVideoUploading
    ? "running"
    : heroVideo
      ? "completed"
      : fallbackToKeyframe
        ? "fallback"
        : heroVideoError
          ? "failed"
          : heroStatus === "completed"
            ? "pending"
            : "blocked";
  const finalStatus: ProjectStepStatus = finalVideo || renderStatus?.status === "completed"
    ? "completed"
    : renderStatus && isActiveRenderState(renderStatus.status)
      ? "running"
      : renderStatus?.status === "failed" || renderStatus?.status === "cancelled"
        ? "failed"
        : heroVideo
          ? normalizeWorkflowStatus(project.workflowSteps?.render)
          : "blocked";

  return [
    { id: "strategy", label: "策略", status: normalizeWorkflowStatus(project.workflowSteps?.strategy || "completed"), detail: "策略与分镜" },
    { id: "keyframes", label: "关键帧", status: keyframeStatus, detail: `${completedFrames}/${project.shots.length} 已完成` },
    { id: "hero", label: "主镜头", status: heroStatus, detail: project.heroShotId ? `镜头 ${resolveHeroShot(project.shots, project.heroShotId)?.index ?? "—"}` : "尚未选择" },
    { id: "video", label: "广告视频", status: videoStatus, detail: heroVideo ? isGeneratedHeroVideo(heroVideo.source) ? `${videoSourceLabel(heroVideo.source)}已就绪` : "完整视频已导入" : "等待生成或导入" },
    { id: "final", label: "成片", status: finalStatus, detail: finalVideo ? "可预览下载" : "等待合成" }
  ];
}

function resolveNextProjectAction({
  missingKeyframes,
  hasHeroShot,
  hasHeroVideo,
  renderStatus,
  hasFinalVideo
}: {
  missingKeyframes: number;
  hasHeroShot: boolean;
  hasHeroVideo: boolean;
  renderStatus?: RenderStatusState["status"];
  hasFinalVideo: boolean;
}): NextProjectAction {
  if (missingKeyframes > 0) return { kind: "keyframes", label: "生成全部关键帧", section: "keyframes" };
  if (!hasHeroShot) return { kind: "navigate", label: "选择主镜头", section: "keyframes" };
  if (!hasHeroVideo) return { kind: "navigate", label: "生成或导入广告视频", section: "hero-shot" };
  if (hasFinalVideo || renderStatus === "completed") return { kind: "navigate", label: "查看最终成片", section: "final" };
  if (renderStatus && isActiveRenderState(renderStatus)) return { kind: "navigate", label: "查看成片进度", section: "final" };
  return { kind: "render", label: renderStatus === "failed" ? "重新生成最终成片" : "生成最终成片", section: "final" };
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function renderStatusLabel(status: RenderStatusState | null) {
  if (!status) return "尚未开始";
  const labels: Record<RenderStatusState["status"], string> = {
    idle: "尚未开始",
    queued: "等待渲染中",
    validating: "校验素材中",
    narrating: "生成旁白中",
    bundling: "准备合成中",
    rendering: "渲染画面中",
    encoding: "编码视频中",
    completed: "成片已就绪",
    failed: "生成失败",
    cancelled: "任务已取消"
  };
  return labels[status.status];
}
function HeroVideoMeta({ video }: { video: HeroVideoState }) {
  return <div className="ad-hero-video-meta"><span>来源：{videoSourceLabel(video.source)}</span><span>{video.name}</span>{video.size ? <span>{formatFileSize(video.size)}</span> : null}{video.width && video.height ? <span>{video.width}×{video.height}</span> : null}{video.durationSec ? <span>{formatDuration(video.durationSec)}</span> : null}</div>;
}

function heroVideoFromAsset(asset: HeroVideoAssetClient): HeroVideoState {
  return { source: asset.source, url: asset.publicUrl, name: asset.fileName, type: asset.mimeType, size: asset.sizeBytes, durationSec: asset.durationSec, width: asset.width, height: asset.height, path: asset.publicUrl, shotId: asset.shotId, fallbackReady: true };
}

function videoSourceLabel(source: HeroVideoSource) {
  if (source === "wan-api") return "Wan 2.7 生成";
  if (source === "happyhorse-api") return "HappyHorse 历史生成";
  if (source === "user-upload" || source === "happyhorse" || source === "happyhorse-manual-import") return "完整广告视频导入";
  return "本地演示素材";
}

function isGeneratedHeroVideo(source: HeroVideoSource) {
  return source === "wan-api" || source === "happyhorse-api";
}

function heroStatusLabel(status: ReturnType<typeof getHeroVideoStatus>) {
  const labels: Record<ReturnType<typeof getHeroVideoStatus>, string> = { "not-started": "未开始", "prompt-ready": "提示词已就绪", "waiting-manual-upload": "等待视频", uploading: "视频处理中", uploaded: "广告视频已就绪", "using-demo-asset": "视频已就绪", failed: "生成失败", "fallback-to-keyframe": "关键帧降级" };
  return labels[status];
}

function heroStatusMessage(status: ReturnType<typeof getHeroVideoStatus>) {
  const messages: Record<ReturnType<typeof getHeroVideoStatus>, string> = { "not-started": "请先选择参考镜头。", "prompt-ready": "可调用 Wan 2.7 生成，或从视频库导入完整广告视频。", "waiting-manual-upload": "等待生成或导入广告视频。", uploading: "正在校验并保存广告视频。", uploaded: "可进入最终成片合成。", "using-demo-asset": "视频已就绪。", failed: "请检查模型状态或视频文件后重试，也可以使用关键帧降级。", "fallback-to-keyframe": "将使用关键帧动效降级。" };
  return messages[status];
}

function routeNodes() {
  return [{ name: "DeepSeek", detail: "策略与提示词", tone: "blue" }, { name: "Qwen-Image", detail: "连续性关键帧", tone: "violet" }, { name: "Wan 2.7", detail: "单首帧视频", tone: "yellow" }, { name: "Remotion", detail: "成片合成", tone: "green" }] as const;
}

function finalRenderCopy(status: RenderStatusState | null, heroVideo: HeroVideoState | null, durationSec: number, shotCount: number) {
  const duration = durationSec;
  if (!heroVideo) return "请先生成或导入广告视频，再生成最终 MP4。";
  if (status?.status === "completed") return "最终成片已导出，可预览和下载。";
  if (status && isActiveRenderState(status.status)) return `正在合成：${status.stage}`;
  return `使用${shotCount}张关键帧、广告视频、字幕与卖点关键词合成 ${duration} 秒广告片。`;
}

function videoLibrarySourceLabel(video: VideoLibraryItemClient) {
  if (video.kind === "final-video" || video.source === "remotion") return "Remotion 成片";
  if (video.source === "wan-api") return "Wan 2.7 生成";
  if (video.source === "happyhorse-api") return "HappyHorse 历史生成";
  return "本地上传";
}

function formatDuration(durationSec: number) {
  const rounded = Math.max(0, Math.round(durationSec));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function projectKeyframesRecord(project: GenerationProject): Record<string, KeyframeResult> {
  return (project.keyframes ?? []).reduce<Record<string, KeyframeResult>>((acc, frame) => {
    acc[frame.frameId ?? frame.shotId] = {
      shotId: frame.shotId,
      frameId: frame.frameId,
      imageUrl: frame.imageUrl,
      localUrl: frame.localUrl,
      provider: frame.provider,
      model: frame.model,
      latencyMs: frame.latencyMs,
      requestId: frame.requestId,
      cacheStatus: frame.cacheStatus,
      fallbackUsed: frame.fallbackUsed,
      fallbackReason: frame.fallbackReason,
      status: frame.status === "ready" ? "ready" : frame.status === "generated" ? "generated" : ["text-qa", "product-qa", "character-qa", "scene-qa", "qa-review"].includes(frame.status) ? "qa-review" : frame.status === "needs-review" ? "needs-review" : frame.status === "pending" ? "loading" : "failed",
      qaResult: project.keyframeQAResults?.filter((item) => item.shotId === frame.shotId && item.frameId === frame.frameId).sort((a, b) => b.attempt - a.attempt)[0] ?? null
    };
    return acc;
  }, {});
}
async function deleteStoredHeroVideo(projectId: string) {
  await fetch(`/api/projects/${encodeURIComponent(projectId)}/hero-video`, { method: "DELETE" }).catch(() => undefined);
}






