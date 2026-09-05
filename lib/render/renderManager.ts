import "server-only";

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import path from "node:path";

import { deletePrivateAsset, getProjectAssetUrl, importPrivateAssetFile, markPrivateAssetsLifecycle } from "../assets/assetStore";
import { hasMp4Signature } from "../assets/media";
import { revokeRenderAssetToken } from "../assets/renderAccess";
import { ensureAutoNarration } from "../audio/cosyVoiceClient";
import { requireOwnedAnonymousProject, updateOwnedAnonymousProject } from "../projects/anonymousProjectStore";
import {
  completeGenerationEvent,
  failGenerationEvent,
  startGenerationEvent,
  updateGenerationEventProgress
} from "../projects/generationEvents";
import { getRemotionBundle } from "./remotionBundle";
import {
  prepareRenderProject,
  RenderProjectError,
  type PreparedRenderProject,
  type RenderRequestInput
} from "./renderProject";
import {
  getRenderState,
  isActiveRenderStatus,
  setRenderState,
  type RenderErrorCode,
  type RenderStatusState
} from "./renderStateStore";
import { assertVideoFontsAvailable, VideoFontLoadError } from "./videoFonts";

type RemotionRenderer = typeof import("@remotion/renderer");
const externalImport = new Function("moduleName", "return import(moduleName)") as <T>(moduleName: string) => Promise<T>;
type ActiveRender = { cancel: () => void };
type QueuedRender = {
  projectId: string;
  input: RenderRequestInput;
  sessionId: string;
  assetBaseUrl: string;
  compositionEventId: string;
};
type RenderScheduler = {
  queue: QueuedRender[];
  running: Set<string>;
  cancelled: Set<string>;
  draining: boolean;
};

const globalRenderRuntime = globalThis as typeof globalThis & {
  adDirectorActiveRenders?: Map<string, ActiveRender>;
  adDirectorRenderScheduler?: RenderScheduler;
};

const activeRenders = globalRenderRuntime.adDirectorActiveRenders ?? new Map<string, ActiveRender>();
const renderScheduler = globalRenderRuntime.adDirectorRenderScheduler ?? {
  queue: [],
  running: new Set<string>(),
  cancelled: new Set<string>(),
  draining: false
};
globalRenderRuntime.adDirectorActiveRenders = activeRenders;
globalRenderRuntime.adDirectorRenderScheduler = renderScheduler;
const STALE_RENDER_MS = 25 * 60 * 1000;
const BUNDLE_TIMEOUT_MS = 5 * 60 * 1000;
const COMPOSITION_TIMEOUT_MS = 2 * 60 * 1000;
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;

export async function startProjectRender(
  projectId: string,
  input: RenderRequestInput,
  sessionId: string,
  assetBaseUrl: string
): Promise<RenderStatusState> {
  new URL(assetBaseUrl);
  const current = await getProjectRenderState(projectId);
  if (isActiveRenderStatus(current.status)) return current;

  const maxConcurrentRenders = positiveIntegerEnv("MAX_CONCURRENT_RENDERS", 1, 4);
  const maxRenderQueueSize = positiveIntegerEnv("MAX_RENDER_QUEUE_SIZE", 6, 30);
  if (renderScheduler.running.size >= maxConcurrentRenders && renderScheduler.queue.length >= maxRenderQueueSize) {
    throw new RenderProjectError(
      "RENDER_QUEUE_FULL",
      "当前渲染队列已满，请稍后再试。"
    );
  }

  await setRenderState(projectId, {
    status: "queued",
    progress: 0.01,
    stage: renderScheduler.running.size >= maxConcurrentRenders ? "等待可用渲染资源" : "等待启动渲染引擎",
    outputUrl: null,
    errorCode: null,
    errorMessage: null,
    warningMessage: null,
    startedAt: new Date().toISOString(),
    completedAt: null
  });
  const event = await startGenerationEvent(sessionId, projectId, {
    stage: "composition",
    provider: "remotion",
    action: "render-final-video",
    message: "成片合成任务已进入服务端渲染队列。",
    progressCurrent: 0,
    progressTotal: 100
  });
  renderScheduler.queue.push({ projectId, input, sessionId, assetBaseUrl, compositionEventId: event.id });
  void drainRenderQueue();
  return getRenderState(projectId);
}

export async function getProjectRenderState(projectId: string) {
  const state = await getRenderState(projectId);
  if (!isActiveRenderStatus(state.status)) return state;
  if (!isRenderScheduledLocally(projectId)) {
    return setRenderState(projectId, {
      status: "failed",
      progress: state.progress,
      stage: "渲染已中断",
      errorCode: "RENDER_INTERRUPTED",
      errorMessage: "服务更新或重启中断了本次渲染，请重新生成成片。",
      completedAt: new Date().toISOString()
    });
  }
  const timestamp = state.updatedAt || state.startedAt;
  const stale = !timestamp || Date.now() - new Date(timestamp).getTime() > STALE_RENDER_MS;
  if (!stale) return state;

  activeRenders.get(projectId)?.cancel();
  activeRenders.delete(projectId);
  return setRenderState(projectId, {
    status: "failed",
    progress: state.progress,
    stage: "渲染已超时",
    errorCode: "RENDER_FAILED",
    errorMessage: "渲染任务长时间没有进度，已自动停止。请检查素材后重新生成。",
    completedAt: new Date().toISOString()
  });
}

export async function cancelProjectRender(projectId: string): Promise<RenderStatusState> {
  const queueIndex = renderScheduler.queue.findIndex((job) => job.projectId === projectId);
  if (queueIndex >= 0) renderScheduler.queue.splice(queueIndex, 1);
  if (renderScheduler.running.has(projectId)) renderScheduler.cancelled.add(projectId);
  activeRenders.get(projectId)?.cancel();
  activeRenders.delete(projectId);
  return setRenderState(projectId, {
    status: "cancelled",
    progress: 0,
    stage: "已取消渲染",
    errorCode: "RENDER_CANCELLED",
    errorMessage: "渲染任务已取消。",
    completedAt: new Date().toISOString()
  });
}

async function runRender(
  projectId: string,
  input: RenderRequestInput,
  sessionId: string,
  assetBaseUrl: string,
  compositionEventId: string
) {
  const startedAt = new Date().toISOString();
  const renderId = randomUUID();
  let prepared: PreparedRenderProject | null = null;

  try {
    throwIfRenderCancelled(projectId);
    let renderInput = input;
    let warningMessage: string | null = null;
    if (!input.project.narrationAssetId) {
      const narrationEvent = await startGenerationEvent(sessionId, projectId, {
        stage: "narration",
        provider: "system",
        action: "generate-narration",
        message: "中文旁白生成已开始。",
        progressCurrent: 0,
        progressTotal: 1
      });
      await setRenderState(projectId, {
        status: "narrating",
        progress: 0.03,
        stage: "正在生成旁白配音",
        startedAt
      });
      const narration = await ensureAutoNarration(projectId, input.project, sessionId);
      if (!narration.success) {
        warningMessage = narration.error;
        await failGenerationEvent(
          sessionId,
          projectId,
          narrationEvent.id,
          "自动旁白生成失败，成片将保留无旁白音轨。",
          "PROVIDER_REQUEST_FAILED"
        );
      } else {
        await completeGenerationEvent(
          sessionId,
          projectId,
          narrationEvent.id,
          "中文旁白已生成并保存到项目私有资产。",
          { progressCurrent: 1, progressTotal: 1 }
        );
      }
      const refreshed = await requireOwnedAnonymousProject(sessionId, projectId);
      renderInput = { ...input, project: refreshed.project };
    }

    throwIfRenderCancelled(projectId);

    prepared = await prepareRenderProject(projectId, renderInput, {
      sessionId,
      assetBaseUrl,
      renderId
    });
    await updateGenerationEventProgress(
      sessionId,
      projectId,
      compositionEventId,
      5,
      100,
      "项目私有素材校验完成。"
    );

    await setRenderState(projectId, {
      status: "validating",
      progress: 0.05,
      stage: "校验视频字体"
    });
    await assertVideoFontsAvailable().catch((error) => {
      throw toRenderError(error, "FONT_LOAD_FAILED", "视频字体加载失败，渲染已终止。");
    });

    await setRenderState(projectId, {
      status: "bundling",
      progress: 0.06,
      stage: "准备 Remotion 合成",
      warningMessage,
      startedAt
    });

    await updateGenerationEventProgress(
      sessionId,
      projectId,
      compositionEventId,
      6,
      100,
      "视频字体校验完成，开始准备 Remotion 合成包。"
    );

    const serveUrl = await withTimeout(
      getRemotionBundle(),
      BUNDLE_TIMEOUT_MS,
      () => new RenderProjectError("BUNDLE_FAILED", "Remotion 打包超时，请重试。")
    ).catch((error) => {
      throw toRenderError(error, "BUNDLE_FAILED", "Remotion 打包失败。");
    });

    throwIfRenderCancelled(projectId);

    const browserExecutable = resolveBrowserExecutable();
    if (process.platform === "win32" && !browserExecutable) {
      throw new RenderProjectError(
        "BUNDLE_FAILED",
        "未找到本机 Chrome 或 Edge。请安装浏览器，或设置 REMOTION_BROWSER_EXECUTABLE。"
      );
    }

    await setRenderState(projectId, {
      status: "bundling",
      progress: 0.09,
      stage: "正在启动本地渲染引擎"
    });

    const { selectComposition, renderMedia, makeCancelSignal } =
      await externalImport<RemotionRenderer>("@remotion/renderer");
    const composition = await withTimeout(
      selectComposition({
        serveUrl,
        id: prepared.compositionId,
        inputProps: prepared.inputProps,
        browserExecutable
      }),
      COMPOSITION_TIMEOUT_MS,
      () => new RenderProjectError("BUNDLE_FAILED", "Remotion 合成配置读取超时，请重试。")
    ).catch((error) => {
      const code = isFontLoadFailure(error) ? "FONT_LOAD_FAILED" : "BUNDLE_FAILED";
      throw toRenderError(
        error,
        code,
        code === "FONT_LOAD_FAILED" ? "视频字体加载失败，渲染已终止。" : "Remotion 合成配置读取失败。"
      );
    });

    const { cancelSignal, cancel } = makeCancelSignal();
    activeRenders.set(projectId, { cancel });
    await setRenderState(projectId, {
      status: "rendering",
      progress: 0.12,
      stage: "正在渲染画面"
    });

    await updateGenerationEventProgress(
      sessionId,
      projectId,
      compositionEventId,
      12,
      100,
      "Remotion 合成环境已就绪，开始渲染画面。"
    );

    let lastProgress = 0.12;
    await withTimeout(
      renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: prepared.outputLocation,
        inputProps: prepared.inputProps,
        overwrite: true,
        cancelSignal,
        browserExecutable,
        onProgress: (progress) => {
          const raw = typeof progress.progress === "number" ? progress.progress : 0;
          const nextProgress = Math.min(0.98, Math.max(0.12, 0.12 + raw * 0.86));
          if (nextProgress - lastProgress >= 0.015 || nextProgress >= 0.98) {
            lastProgress = nextProgress;
            void setRenderState(projectId, {
              status: nextProgress > 0.9 ? "encoding" : "rendering",
              progress: nextProgress,
              stage: nextProgress > 0.9 ? "正在编码 MP4" : "正在渲染画面"
            });
            void updateGenerationEventProgress(
              sessionId,
              projectId,
              compositionEventId,
              Math.round(nextProgress * 100),
              100,
              nextProgress > 0.9 ? "正在编码 MP4。" : "正在渲染广告画面。"
            );
          }
        }
      }),
      RENDER_TIMEOUT_MS,
      () => {
        cancel();
        return new RenderProjectError(
          "RENDER_FAILED",
          "成片渲染超过 20 分钟，任务已自动停止，请重试。"
        );
      }
    ).catch((error) => {
      if (String(error instanceof Error ? error.message : error).toLowerCase().includes("cancel")) {
        throw new RenderProjectError("RENDER_CANCELLED", "渲染任务已取消。");
      }
      throw toRenderError(error, "RENDER_FAILED", "Remotion 渲染失败。");
    });

    activeRenders.delete(projectId);
    const output = await persistFinalVideo(
      sessionId,
      projectId,
      prepared.outputLocation,
      prepared.inputProps.durationInFrames / prepared.inputProps.fps
    );
    await completeGenerationEvent(
      sessionId,
      projectId,
      compositionEventId,
      "Remotion 成片已生成并保存到项目私有资产。",
      { progressCurrent: 100, progressTotal: 100 }
    );
    await setRenderState(projectId, {
      status: "completed",
      progress: 1,
      stage: "成片已生成",
      outputUrl: output.url,
      errorCode: null,
      errorMessage: null,
      warningMessage,
      completedAt: new Date().toISOString()
    });
  } catch (error) {
    activeRenders.delete(projectId);
    const renderError = normalizeRenderError(error);
    if (renderError.code === "RENDER_CANCELLED") {
      await completeGenerationEvent(
        sessionId,
        projectId,
        compositionEventId,
        "Remotion 成片任务已取消。",
        { status: "cancelled" }
      ).catch(() => undefined);
    } else {
      await failGenerationEvent(
        sessionId,
        projectId,
        compositionEventId,
        "Remotion 成片生成失败：" + renderError.message,
        "RENDER_FAILED"
      ).catch(() => undefined);
    }
    await setRenderState(projectId, {
      status: renderError.code === "RENDER_CANCELLED" ? "cancelled" : "failed",
      progress: 0,
      stage: renderError.code === "RENDER_CANCELLED" ? "已取消渲染" : "渲染失败",
      errorCode: renderError.code,
      errorMessage: renderError.message,
      completedAt: new Date().toISOString()
    });
  } finally {
    renderScheduler.cancelled.delete(projectId);
    if (prepared) {
      revokeRenderAssetToken(prepared.renderAssetToken);
      await rm(path.dirname(prepared.outputLocation), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function drainRenderQueue(): Promise<void> {
  if (renderScheduler.draining) return;
  renderScheduler.draining = true;
  try {
    const maxConcurrentRenders = positiveIntegerEnv("MAX_CONCURRENT_RENDERS", 1, 4);
    while (renderScheduler.running.size < maxConcurrentRenders && renderScheduler.queue.length > 0) {
      const job = renderScheduler.queue.shift();
      if (!job) break;
      if (renderScheduler.cancelled.has(job.projectId)) continue;
      renderScheduler.running.add(job.projectId);
      void executeQueuedRender(job).finally(() => {
        renderScheduler.running.delete(job.projectId);
        activeRenders.delete(job.projectId);
        void drainRenderQueue();
      });
    }
  } finally {
    renderScheduler.draining = false;
  }
}

async function executeQueuedRender(job: QueuedRender): Promise<void> {
  await setRenderState(job.projectId, {
    status: "validating",
    progress: 0.02,
    stage: "校验私有素材"
  });
  await runRender(
    job.projectId,
    job.input,
    job.sessionId,
    job.assetBaseUrl,
    job.compositionEventId
  );
}

function isRenderScheduledLocally(projectId: string) {
  return renderScheduler.running.has(projectId)
    || renderScheduler.queue.some((job) => job.projectId === projectId);
}

function throwIfRenderCancelled(projectId: string) {
  if (renderScheduler.cancelled.has(projectId)) {
    throw new RenderProjectError("RENDER_CANCELLED", "渲染任务已取消。");
  }
}

function positiveIntegerEnv(name: string, fallback: number, maximum: number) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(maximum, parsed);
}

async function persistFinalVideo(
  sessionId: string,
  projectId: string,
  outputLocation: string,
  durationSec: number
) {
  const info = await stat(outputLocation).catch(() => null);
  if (!info?.isFile() || info.size < 1024) {
    throw new RenderProjectError("ENCODE_FAILED", "Remotion 没有输出有效的 MP4 文件。");
  }

  const handle = await open(outputLocation, "r");
  try {
    const signature = new Uint8Array(12);
    const result = await handle.read(signature, 0, signature.length, 0);
    if (result.bytesRead < signature.length || !hasMp4Signature(signature)) {
      throw new RenderProjectError("ENCODE_FAILED", "Remotion 输出文件不是有效的 MP4。");
    }
  } finally {
    await handle.close();
  }

  const current = await requireOwnedAnonymousProject(sessionId, projectId);
  const previousAssetId = current.project.finalVideoAssetId;
  const asset = await importPrivateAssetFile(sessionId, projectId, {
    kind: "final-video",
    source: "remotion",
    role: "ad-final",
    fileName: "ad-final.mp4",
    mimeType: "video/mp4",
    sourcePath: outputLocation,
    durationSec
  });
  const url = getProjectAssetUrl(projectId, asset.id);

  try {
    await updateOwnedAnonymousProject(sessionId, projectId, {
      status: "completed",
      finalVideoAssetId: asset.id,
      finalVideoUrl: url,
      finalVideo: {
        status: "completed",
        assetId: asset.id,
        url,
        progress: 1,
        fileName: "ad-final.mp4",
        durationSec,
        storageTransition: "PRIVATE_ASSET_V1"
      },
      workflowSteps: {
        ...(current.project.workflowSteps ?? defaultWorkflow()),
        render: "completed"
      }
    });
  } catch (error) {
    await deletePrivateAsset(sessionId, projectId, asset.id).catch(() => undefined);
    throw error;
  }

  if (previousAssetId && previousAssetId !== asset.id) {
    await markPrivateAssetsLifecycle(sessionId, projectId, [previousAssetId], "orphaned").catch(() => undefined);
  }
  return { assetId: asset.id, url, sizeBytes: asset.sizeBytes };
}

export function resolveBrowserExecutable() {
  const configured = process.env.REMOTION_BROWSER_EXECUTABLE?.trim();
  const candidates = [
    configured,
    process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined,
    process.platform === "win32" ? "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" : undefined,
    process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined,
    process.platform === "win32" ? "C:/Program Files/Microsoft/Edge/Application/msedge.exe" : undefined
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate));
}

function toRenderError(error: unknown, code: RenderErrorCode, fallback: string) {
  if (error instanceof RenderProjectError) return error;
  const message = error instanceof Error ? error.message : fallback;
  return new RenderProjectError(code, sanitizeRenderError(message) || fallback);
}

function isFontLoadFailure(error: unknown) {
  if (error instanceof VideoFontLoadError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /font|woff2|addirectorsans|字体/i.test(message);
}

function normalizeRenderError(error: unknown): RenderProjectError {
  if (error instanceof RenderProjectError) return error;
  if (error instanceof Error) {
    return new RenderProjectError(
      "RENDER_FAILED",
      sanitizeRenderError(error.message) || "Remotion 渲染失败。"
    );
  }
  return new RenderProjectError("RENDER_FAILED", "Remotion 渲染失败。");
}

function sanitizeRenderError(message: string) {
  return message
    .replaceAll(process.cwd(), "[local-path]")
    .replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/gi, "[redacted]")
    .slice(0, 220);
}
function defaultWorkflow() {
  return {
    brief: "completed" as const,
    strategy: "completed" as const,
    storyboard: "completed" as const,
    keyframes: "completed" as const,
    heroShot: "completed" as const,
    render: "running" as const
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorFactory: () => Error
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(errorFactory()), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
