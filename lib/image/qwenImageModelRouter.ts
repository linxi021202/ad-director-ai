import "server-only";

import { createHash } from "node:crypto";
import { getAIConfig } from "../config/ai";
import { resolveProviderApiKey } from "../secrets/resolver";
import { callQwenImage } from "./qwenImageClient";
import { diagnoseDashScopeConnection } from "./dashscopeDiagnostics";
import { shouldFallbackQwen, type QwenFailureCode } from "./qwenImageErrors";
import type { QwenImageRequest, QwenImageResult, QwenNetworkFailure, QwenSubmissionDiagnostic } from "./types";

export const QWEN_IMAGE_CANDIDATES = [
  { modelId: "qwen-image", textToImage: true, referenceImageInput: false, imageEditing: false, priority: 1 },
  { modelId: "qwen-image-3.0", textToImage: true, referenceImageInput: true, imageEditing: true, priority: 2 },
  { modelId: "qwen-image-2.0", textToImage: true, referenceImageInput: true, imageEditing: true, priority: 3 }
] as const;

export type QwenModelAttempt = {
  model: string; attempt: number; status: "completed" | "failed" | "blocked" | "running";
  startedAt: number; completedAt: number; errorCode?: string; error?: string;
  providerErrorCode?: string; httpStatus?: number; requestId?: string; taskId?: string;
  referenceCount: number; size: string; assetId?: string; mode: string;
  promptExtend: boolean; watermark: boolean;
  providerStatus?: string; submittedAt?: number; lastPolledAt?: number; pollCount?: number; imageUrl?: string;
  submissionElapsedMs?: number; downloadElapsedMs?: number;
  submissionDiagnostic?: QwenSubmissionDiagnostic; networkFailure?: QwenNetworkFailure;
};

type Availability = { code: string; cooldownUntil: number; lastCheckedAt: number };
const availability = new Map<string, Map<string, Availability>>();

function credentialScope(sessionId: string, key: string | null) {
  return `${sessionId}:${createHash("sha256").update(key ?? "unconfigured").digest("hex").slice(0, 20)}`;
}

export function clearQwenModelAvailability(sessionId: string) {
  for (const key of availability.keys()) if (key.startsWith(`${sessionId}:`)) availability.delete(key);
}

function availabilityTtl(code: QwenFailureCode, retryAfter?: number) {
  if (code === "QUOTA_EXHAUSTED" || code === "INSUFFICIENT_BALANCE") return 30 * 60_000;
  if (code === "MODEL_NOT_AVAILABLE" || code === "MODEL_NOT_SUPPORTED_IN_REGION") return 60 * 60_000;
  if (code === "RATE_LIMITED") return Math.max(30_000, Math.min(retryAfter ?? 60_000, 5 * 60_000));
  return 30_000;
}

function legacySize(size: string) {
  const [width, height] = size.split("*").map(Number);
  if (!width || !height) return "928*1664";
  if (width <= 1664 && height <= 1664 && width * height <= 1_544_192) return size;
  return width > height ? "1664*928" : width === height ? "1240*1240" : "928*1664";
}

export async function generateQwenImageAdaptive(input: QwenImageRequest, onAttempt?: (attempt: QwenModelAttempt) => Promise<void>, call: typeof callQwenImage = callQwenImage): Promise<QwenImageResult> {
  const key = await resolveProviderApiKey("qwen-image", input.sessionId);
  const scope = credentialScope(input.sessionId ?? "", key);
  const state = availability.get(scope) ?? new Map<string, Availability>();
  availability.set(scope, state);
  const referenceCount = (input.referenceImages?.length ? input.referenceImages : input.referenceImage ? [input.referenceImage] : []).length;
  const mode = referenceCount ? "reference-keyframe" : "text-keyframe";
  const defaults = getAIConfig({ allowSessionSecrets: true }).qwenImage;
  const parameters = { promptExtend: input.promptExtend ?? defaults.promptExtend, watermark: input.watermark ?? defaults.watermark };
  let index = 0;
  let last: QwenImageResult | undefined;

  if (input.resumeTaskId) {
    const startedAt = Date.now();
    const result = await call({ ...input, model: "qwen-image-3.0", onTaskProgress: async (progress) => {
      await input.onTaskProgress?.(progress);
      await onAttempt?.({ model: "qwen-image-3.0", attempt: 2, status: progress.status === "FAILED" ? "failed" : progress.status === "SUCCEEDED" ? "completed" : "running",
        startedAt: progress.submittedAt, completedAt: Date.now(), requestId: progress.requestId, taskId: progress.taskId,
        referenceCount, size: input.size ?? "1152*2048", mode, providerStatus: progress.status,
        submittedAt: progress.submittedAt, lastPolledAt: progress.lastPolledAt, pollCount: progress.pollCount,
        imageUrl: progress.imageUrl, ...parameters });
    } });
    await onAttempt?.({ model: "qwen-image-3.0", attempt: 2, status: result.success ? "completed" : result.errorCode === "TASK_POLL_INTERRUPTED" ? "running" : "failed",
      startedAt, completedAt: Date.now(), errorCode: result.errorCode, error: result.error,
      providerErrorCode: result.providerErrorCode, httpStatus: result.httpStatus, requestId: result.requestId,
      taskId: result.taskId, referenceCount, size: input.size ?? "1152*2048", assetId: result.assetId, mode,
      submissionElapsedMs: result.submissionElapsedMs, downloadElapsedMs: result.downloadElapsedMs,
      submissionDiagnostic: result.submissionDiagnostic, networkFailure: result.networkFailure, ...parameters });
    return result;
  }

  for (const candidate of QWEN_IMAGE_CANDIDATES) {
    const size = candidate.modelId === "qwen-image" ? legacySize(input.size ?? "1152*2048") : input.size ?? "1152*2048";
    const now = Date.now();
    const attempt = ++index;
    if (referenceCount && !candidate.referenceImageInput) {
      await onAttempt?.({ model: candidate.modelId, attempt, status: "blocked", startedAt: now, completedAt: now,
        errorCode: "MODEL_SKIPPED_CAPABILITY_MISMATCH", error: "当前关键帧需要参考图输入，此模型不支持，已跳过。", referenceCount, size, mode, ...parameters });
      continue;
    }
    const cached = state.get(candidate.modelId);
    if (cached && cached.cooldownUntil > now) {
      await onAttempt?.({ model: candidate.modelId, attempt, status: "blocked", startedAt: now, completedAt: now,
        errorCode: "MODEL_SKIPPED_COOLDOWN", error: `该模型此前返回 ${cached.code}，冷却至 ${new Date(cached.cooldownUntil).toISOString()}。`, referenceCount, size, mode, ...parameters });
      continue;
    }
    for (let rateRetry = 0; rateRetry < 2; rateRetry += 1) {
      const result = await call({ ...input, model: candidate.modelId, size,
        onSubmissionStart: async (diagnostic) => {
          await input.onSubmissionStart?.(diagnostic);
          await onAttempt?.({ model: candidate.modelId, attempt, status: "running", startedAt: diagnostic.requestStartedAt,
            completedAt: diagnostic.requestStartedAt, referenceCount, size, mode, submissionDiagnostic: diagnostic, ...parameters });
        },
        onTaskProgress: async (progress) => {
          await input.onTaskProgress?.(progress);
          await onAttempt?.({ model: candidate.modelId, attempt, status: progress.status === "FAILED" ? "failed" : progress.status === "SUCCEEDED" ? "completed" : "running",
            startedAt: progress.submittedAt, completedAt: Date.now(), requestId: progress.requestId, taskId: progress.taskId,
            referenceCount, size, mode, providerStatus: progress.status, submittedAt: progress.submittedAt,
            lastPolledAt: progress.lastPolledAt, pollCount: progress.pollCount, imageUrl: progress.imageUrl, ...parameters });
        } });
      const code = result.errorCode as QwenFailureCode | undefined;
      await onAttempt?.({ model: candidate.modelId, attempt: rateRetry ? ++index : attempt, status: result.success ? "completed" : result.errorCode === "TASK_POLL_INTERRUPTED" ? "running" : "failed",
        startedAt: result.requestStartedAt ?? now, completedAt: result.requestCompletedAt ?? Date.now(),
        errorCode: result.errorCode, error: result.error, providerErrorCode: result.providerErrorCode, httpStatus: result.httpStatus,
        requestId: result.requestId, taskId: result.taskId, referenceCount, size, assetId: result.assetId, mode,
        submissionElapsedMs: result.submissionElapsedMs, downloadElapsedMs: result.downloadElapsedMs,
        submissionDiagnostic: result.submissionDiagnostic, networkFailure: result.networkFailure, ...parameters });
      if (result.success) { state.delete(candidate.modelId); return result; }
      last = result;
      if (code === "RATE_LIMITED" && !rateRetry && (result.retryAfterMs ?? 1000) <= 5000) {
        await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs ?? 1000));
        continue;
      }
      if (!code || !shouldFallbackQwen(code)) return result;
      state.set(candidate.modelId, { code, cooldownUntil: Date.now() + availabilityTtl(code, result.retryAfterMs), lastCheckedAt: Date.now() });
      break;
    }
  }
  return last ?? { success: false, provider: "dashscope", model: referenceCount ? "qwen-image-3.0" : "qwen-image",
    latencyMs: 0, size: input.size ?? "1152*2048", cacheStatus: "not-requested", errorCode: "MODEL_NOT_AVAILABLE",
    error: "当前可用模型均无法完成参考图驱动生成，请查看调用日志。" };
}

export async function inspectQwenImageModels(sessionId: string) {
  const key = await resolveProviderApiKey("qwen-image", sessionId);
  const baseUrl = getAIConfig({ allowSessionSecrets: true }).qwenImage.baseUrl;
  const connection = await diagnoseDashScopeConnection(baseUrl, key ?? undefined);
  const scope = credentialScope(sessionId, key);
  const cached = availability.get(scope);
  let listed: Set<string> | undefined;
  let notice = "模型列表未验证；将在首次生成时检测额度与实际能力。";
  if (key) {
    try {
      const base = getAIConfig({ allowSessionSecrets: true }).qwenImage.baseUrl.replace(/\/+$/, "");
      const found = new Set<string>();
      let validList = false;
      for (let page = 1; page <= 10; page += 1) {
        const response = await fetch(`${base}/api/v1/models?page_no=${page}&page_size=100`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
        const payload = await response.json() as { data?: Array<{ model?: string; id?: string }>; output?: { total?: number; models?: Array<{ model?: string; id?: string }> } };
        const models = Array.isArray(payload.output?.models) ? payload.output.models : payload.data;
        if (!response.ok || !Array.isArray(models)) break;
        validList = true;
        for (const item of models) {
          const id = item.model ?? item.id;
          if (id) found.add(id);
        }
        if (QWEN_IMAGE_CANDIDATES.every((candidate) => found.has(candidate.modelId)) || models.length < 100 || page * 100 >= (payload.output?.total ?? Number.POSITIVE_INFINITY)) break;
      }
      if (validList) {
        listed = found;
        notice = "模型列表可读取；列表命中不代表仍有生成额度，额度将在首次生成时验证。";
      } else notice = "模型列表不可读取；将在首次生成时检测。";
    } catch { notice = "模型列表暂时不可读取；将在首次生成时检测。"; }
  } else notice = "请先配置百炼 API Key；检测不会生成收费图片。";
  return { notice, connection, models: QWEN_IMAGE_CANDIDATES.map((candidate) => {
    const state = cached?.get(candidate.modelId);
    const cooling = state && state.cooldownUntil > Date.now() ? state : undefined;
    return { ...candidate, status: !key ? "unknown" : cooling ? "unavailable" : listed?.has(candidate.modelId) ? "available" : "unknown",
      reason: cooling ? `最近失败：${cooling.code}，冷却后重试。` : listed?.has(candidate.modelId) ? "模型列表已列出，额度待首次生成验证。" : "未在当前响应中确认；首次生成时检测。",
      lastCheckedAt: cooling?.lastCheckedAt ?? null, cooldownUntil: cooling?.cooldownUntil ?? null };
  }) };
}
