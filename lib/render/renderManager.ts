import "server-only";

import { existsSync } from "node:fs";
import { ensureAutoNarration } from "../audio/cosyVoiceClient";
import { getRemotionBundle } from "./remotionBundle";
import { prepareRenderProject, RenderProjectError, type RenderRequestInput } from "./renderProject";
import { getRenderState, isActiveRenderStatus, setRenderState, type RenderErrorCode, type RenderStatusState } from "./renderStateStore";
import { assertVideoFontsAvailable, VideoFontLoadError } from "./videoFonts";

type RemotionRenderer = typeof import("@remotion/renderer");
const externalImport = new Function("moduleName", "return import(moduleName)") as <T>(moduleName: string) => Promise<T>;
type ActiveRender = { cancel: () => void };

const activeRenders = new Map<string, ActiveRender>();
const STALE_RENDER_MS = 25 * 60 * 1000;
const BUNDLE_TIMEOUT_MS = 5 * 60 * 1000;
const COMPOSITION_TIMEOUT_MS = 2 * 60 * 1000;
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;

export async function startProjectRender(projectId: string, input: RenderRequestInput, sessionId?: string): Promise<RenderStatusState> {
  const current = await getProjectRenderState(projectId);
  if (isActiveRenderStatus(current.status)) return current;
  await setRenderState(projectId, {
    status: "validating", progress: 0, stage: "校验素材", outputUrl: null,
    errorCode: null, errorMessage: null, warningMessage: null,
    startedAt: new Date().toISOString(), completedAt: null
  });
  void runRender(projectId, input, sessionId);
  return getRenderState(projectId);
}

export async function getProjectRenderState(projectId: string) {
  const state = await getRenderState(projectId);
  if (!isActiveRenderStatus(state.status)) return state;
  const timestamp = state.updatedAt || state.startedAt;
  const stale = !timestamp || Date.now() - new Date(timestamp).getTime() > STALE_RENDER_MS;
  if (!stale) return state;
  activeRenders.get(projectId)?.cancel();
  activeRenders.delete(projectId);
  return setRenderState(projectId, {
    status: "failed", progress: state.progress, stage: "渲染已超时",
    errorCode: "RENDER_FAILED", errorMessage: "渲染任务长时间没有进度，已自动停止。请检查素材后重新生成。",
    completedAt: new Date().toISOString()
  });
}

export async function cancelProjectRender(projectId: string): Promise<RenderStatusState> {
  activeRenders.get(projectId)?.cancel();
  activeRenders.delete(projectId);
  return setRenderState(projectId, {
    status: "cancelled", progress: 0, stage: "已取消渲染",
    errorCode: "RENDER_CANCELLED", errorMessage: "渲染任务已取消。", completedAt: new Date().toISOString()
  });
}

async function runRender(projectId: string, input: RenderRequestInput, sessionId?: string) {
  const startedAt = new Date().toISOString();
  try {
    let renderInput = input;
    let warningMessage: string | null = null;
    if (!input.voiceoverUrl) {
      await setRenderState(projectId, { status: "narrating", progress: 0.03, stage: "正在生成旁白配音", startedAt });
      const narration = await ensureAutoNarration(projectId, input.project, sessionId);
      if (narration.success) renderInput = { ...input, voiceoverUrl: narration.publicUrl };
      else warningMessage = narration.error;
    }

    const prepared = await prepareRenderProject(projectId, renderInput);
    await setRenderState(projectId, { status: "validating", progress: 0.05, stage: "校验视频字体" });
    await assertVideoFontsAvailable().catch((error) => {
      throw toRenderError(error, "FONT_LOAD_FAILED", "视频字体加载失败，渲染已终止。");
    });
    await setRenderState(projectId, {
      status: "bundling", progress: 0.06, stage: "准备 Remotion Composition",
      warningMessage, startedAt
    });

    const serveUrl = await withTimeout(getRemotionBundle(), BUNDLE_TIMEOUT_MS,
      () => new RenderProjectError("BUNDLE_FAILED", "Remotion 打包超时，请重试。"))
      .catch((error) => { throw toRenderError(error, "BUNDLE_FAILED", "Remotion 打包失败。"); });

    const browserExecutable = resolveBrowserExecutable();
    if (process.platform === "win32" && !browserExecutable) {
      throw new RenderProjectError("BUNDLE_FAILED", "未找到本机 Chrome 或 Edge。请安装浏览器，或设置 REMOTION_BROWSER_EXECUTABLE。");
    }

    await setRenderState(projectId, { status: "bundling", progress: 0.09, stage: "正在启动本地渲染引擎" });
    const { selectComposition, renderMedia, makeCancelSignal } = await externalImport<RemotionRenderer>("@remotion/renderer");
    const composition = await withTimeout(selectComposition({
      serveUrl, id: prepared.compositionId, inputProps: prepared.inputProps, browserExecutable
    }), COMPOSITION_TIMEOUT_MS,
      () => new RenderProjectError("BUNDLE_FAILED", "Remotion 合成配置读取超时，请重试。"))
      .catch((error) => {
        const code = isFontLoadFailure(error) ? "FONT_LOAD_FAILED" : "BUNDLE_FAILED";
        throw toRenderError(error, code, code === "FONT_LOAD_FAILED" ? "视频字体加载失败，渲染已终止。" : "Remotion Composition 读取失败。");
      });

    const { cancelSignal, cancel } = makeCancelSignal();
    activeRenders.set(projectId, { cancel });
    await setRenderState(projectId, { status: "rendering", progress: 0.12, stage: "正在渲染画面" });

    let lastProgress = 0.12;
    await withTimeout(renderMedia({
      composition, serveUrl, codec: "h264", outputLocation: prepared.outputLocation,
      inputProps: prepared.inputProps, overwrite: true, cancelSignal, browserExecutable,
      onProgress: (progress) => {
        const raw = typeof progress.progress === "number" ? progress.progress : 0;
        const nextProgress = Math.min(0.98, Math.max(0.12, 0.12 + raw * 0.86));
        if (nextProgress - lastProgress >= 0.015 || nextProgress >= 0.98) {
          lastProgress = nextProgress;
          void setRenderState(projectId, {
            status: nextProgress > 0.9 ? "encoding" : "rendering", progress: nextProgress,
            stage: nextProgress > 0.9 ? "正在编码 MP4" : "正在渲染画面"
          });
        }
      }
    }), RENDER_TIMEOUT_MS, () => {
      cancel();
      return new RenderProjectError("RENDER_FAILED", "成片渲染超过 20 分钟，任务已自动停止，请重试。");
    }).catch((error) => {
      if (String(error instanceof Error ? error.message : error).toLowerCase().includes("cancel")) {
        throw new RenderProjectError("RENDER_CANCELLED", "渲染任务已取消。");
      }
      throw toRenderError(error, "RENDER_FAILED", "Remotion 渲染失败。");
    });

    activeRenders.delete(projectId);
    await setRenderState(projectId, {
      status: "completed", progress: 1, stage: "成片已生成", outputUrl: prepared.outputUrl,
      errorCode: null, errorMessage: null, warningMessage, completedAt: new Date().toISOString()
    });
  } catch (error) {
    activeRenders.delete(projectId);
    const renderError = normalizeRenderError(error);
    await setRenderState(projectId, {
      status: renderError.code === "RENDER_CANCELLED" ? "cancelled" : "failed", progress: 0,
      stage: renderError.code === "RENDER_CANCELLED" ? "已取消渲染" : "渲染失败",
      errorCode: renderError.code, errorMessage: renderError.message, completedAt: new Date().toISOString()
    });
  }
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
  if (error instanceof Error) return new RenderProjectError("RENDER_FAILED", sanitizeRenderError(error.message) || "Remotion 渲染失败。");
  return new RenderProjectError("RENDER_FAILED", "Remotion 渲染失败。");
}
function sanitizeRenderError(message: string) {
  return message.replace(/[A-Z]:\\[^\s"']+/gi, "[local-path]").replace(/\/[^\s"']+\/public\/[^\s"']+/g, "[local-path]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]+/gi, "[redacted]").slice(0, 220);
}
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorFactory: () => Error): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_resolve, reject) => { timeoutId = setTimeout(() => reject(errorFactory()), timeoutMs); })]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

