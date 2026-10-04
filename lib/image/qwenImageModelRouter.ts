import "server-only";

import { createHash } from "node:crypto";
import { getAIConfig } from "../config/ai";
import { resolveProviderApiKey } from "../secrets/resolver";
import { callQwenImage } from "./qwenImageClient";
import { diagnoseDashScopeConnection } from "./dashscopeDiagnostics";
import { qwenImageUserMessage, shouldFallbackQwen, type QwenFailureCode } from "./qwenImageErrors";
import type { QwenImageRequest, QwenImageResult, QwenImageTaskType, QwenNetworkFailure, QwenSubmissionDiagnostic } from "./types";

export const QWEN_TEXT_MODELS = ["qwen-image-max-2025-12-30", "qwen-image-2.0-pro-2026-06-22", "qwen-image-plus"] as const;
export const QWEN_REFERENCE_MODELS = ["qwen-image-edit-max-2026-01-16", "qwen-image-2.0-pro-2026-06-22", "qwen-image-edit-plus", "qwen-image-edit"] as const;
export const QWEN_FREE_ONLY = process.env.QWEN_FREE_ONLY !== "false";
export const DEFAULT_QWEN_ACCOUNT_HARD_STOP_TTL_MS = 5 * 60_000;
export const QWEN_IMAGE_CANDIDATES = [...new Set([...QWEN_TEXT_MODELS, ...QWEN_REFERENCE_MODELS])].map((modelId) => ({
  modelId, textToImage: QWEN_TEXT_MODELS.includes(modelId as typeof QWEN_TEXT_MODELS[number]),
  referenceImageInput: QWEN_REFERENCE_MODELS.includes(modelId as typeof QWEN_REFERENCE_MODELS[number]),
  imageEditing: QWEN_REFERENCE_MODELS.includes(modelId as typeof QWEN_REFERENCE_MODELS[number])
}));

export function selectQwenImageModels(input: QwenImageRequest): string[] {
  const references = input.referenceImages?.length ? input.referenceImages.length : input.referenceImage ? 1 : 0;
  const taskType = input.taskType ?? (references ? "keyframe_generation" : "scene_candidate_text_only");
  const needsReferences = taskType === "scene_candidate_with_product_reference" || taskType === "keyframe_generation" || taskType === "keyframe_regeneration";
  if (needsReferences && !references) throw new Error("REFERENCE_IMAGE_REQUIRED");
  if (!needsReferences && references) throw new Error("MODEL_ROUTING_FAILED: 文生图任务不能携带参考图。");
  if (input.requiredCapabilities?.referenceImageInput && !references) throw new Error("REFERENCE_IMAGE_REQUIRED");
  if (input.requiredCapabilities?.referenceImageInput === false && needsReferences) throw new Error("MODEL_ROUTING_FAILED: 任务能力要求相互冲突。");
  if (input.requiredCapabilities?.textToImage && needsReferences) throw new Error("MODEL_ROUTING_FAILED: 任务能力要求相互冲突。");
  if (input.requiredCapabilities?.highConsistency && !needsReferences) throw new Error("MODEL_ROUTING_FAILED: 高一致性任务需要参考图。");
  return needsReferences ? [...QWEN_REFERENCE_MODELS] : [...QWEN_TEXT_MODELS];
}

export type QwenModelAttempt = {
  taskType: QwenImageTaskType;
  model: string; attempt: number; status: "completed" | "failed" | "blocked" | "running";
  startedAt: number; completedAt: number; errorCode?: string; error?: string;
  providerErrorCode?: string; httpStatus?: number; requestId?: string; taskId?: string;
  referenceCount: number; size: string; assetId?: string; mode: string;
  promptExtend: boolean; watermark: boolean;
  providerStatus?: string; submittedAt?: number; lastPolledAt?: number; pollCount?: number; imageUrl?: string;
  submissionElapsedMs?: number; downloadElapsedMs?: number;
  submissionDiagnostic?: QwenSubmissionDiagnostic; networkFailure?: QwenNetworkFailure;
  providerOutcome?: QwenImageResult["providerOutcome"]; timeoutSource?: string;
  responseReceivedAt?: number; assetPersistedAt?: number;
  projectPatchedAt?: number;
  projectPatchStartedAt?: number; projectPatchCompletedAt?: number;
  projectVersionBefore?: number; projectVersionAfter?: number; keyframeRecordId?: string;
  routerDecision?: "FALLBACK_NEXT_MODEL" | "STOP_PROVIDER" | "STOP_REQUEST" | "RETRY_SAME_MODEL" | "SKIP_CACHED_MODEL" | "SELECT_MODEL";
  routerResult?: "FREE_TIER_EXHAUSTED" | "ACCOUNT_ARREARAGE" | "ACCOUNT_AUTH_FAILED" | "SUCCESS" | "MODEL_UNAVAILABLE" | "REQUEST_FAILED";
  selectedModel?: string;
  routerStage?: "ACCOUNT_GATE" | "CAPABILITY_FILTER" | "MODEL_SELECTION" | "PROVIDER_CALL";
  blockedReason?: "ACCOUNT_ARREARAGE_CACHE_VALID" | "ACCOUNT_ARREARAGE_FRESH_PROVIDER_RESPONSE" | "ACCOUNT_AUTH_FAILED_CACHE_VALID" | "ACCOUNT_AUTH_FAILED_FRESH_PROVIDER_RESPONSE" | "NO_COMPATIBLE_MODEL";
  accountState?: AccountHealth["status"];
  accountStateSource?: "PROVIDER_RESPONSE" | "CACHE" | "UNKNOWN";
  apiKeyFingerprintMasked?: string;
  accountStateCheckedAt?: number;
  accountStateExpiresAt?: number;
  requiredCapabilities?: QwenImageRequest["requiredCapabilities"];
  candidateModels?: string[];
  skippedModels?: string[];
  providerRequestModel?: string;
  fallbackReason?: string;
  finalModel?: string;
};

type Availability = { code: string; status: "AVAILABLE" | "FREE_TIER_EXHAUSTED" | "RATE_LIMITED" | "TEMP_UNAVAILABLE" | "UNKNOWN"; cooldownUntil: number | null; lastCheckedAt: number; apiKeyFingerprint: string };
type AccountHealth = { status: "HEALTHY" | "ARREARAGE" | "AUTH_FAILED" | "UNKNOWN"; checkedAt: number; cooldownUntil: number | null };
const availability = new Map<string, Map<string, Availability>>();
const providerAccountState = new Map<string, AccountHealth>();
const modelQueues = new Map<string, Promise<void>>();

async function withModelSlot<T>(scope: string, model: string, work: () => Promise<T>): Promise<T> {
  const slot = `${scope}:${model}`;
  const previous = modelQueues.get(slot) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  modelQueues.set(slot, next);
  await previous.catch(() => undefined);
  try { return await work(); } finally { release(); if (modelQueues.get(slot) === next) modelQueues.delete(slot); }
}

function keyFingerprint(key: string | null) {
  return createHash("sha256").update(key ?? "unconfigured").digest("hex").slice(0, 20);
}

function credentialScope(sessionId: string, key: string | null) {
  return `${sessionId}:${keyFingerprint(key)}`;
}

function accountHardStopTtlMs() {
  const configured = Number(process.env.QWEN_ACCOUNT_HARD_STOP_TTL_MS);
  return Number.isFinite(configured) && configured >= 30_000 && configured <= 30 * 60_000
    ? configured : DEFAULT_QWEN_ACCOUNT_HARD_STOP_TTL_MS;
}

function activeAccountHealth(scope: string): AccountHealth | undefined {
  const health = providerAccountState.get(scope);
  if (health?.cooldownUntil && health.cooldownUntil <= Date.now()) {
    providerAccountState.delete(scope);
    return undefined;
  }
  return health;
}

export function clearQwenModelAvailability(sessionId: string) {
  for (const key of availability.keys()) if (key.startsWith(`${sessionId}:`)) availability.delete(key);
  for (const key of providerAccountState.keys()) if (key.startsWith(`${sessionId}:`)) providerAccountState.delete(key);
}

function availabilityTtl(code: QwenFailureCode, retryAfter?: number) {
  if (code === "MODEL_NOT_AVAILABLE" || code === "MODEL_NOT_SUPPORTED_IN_REGION") return 60 * 60_000;
  if (code === "MODEL_TEMPORARILY_UNAVAILABLE") return 60_000;
  if (code === "RATE_LIMITED") return Math.max(30_000, Math.min(retryAfter ?? 60_000, 5 * 60_000));
  return 30_000;
}

function isAccountError(code?: string): code is "INSUFFICIENT_BALANCE" | "AUTH_FAILED" {
  return code === "INSUFFICIENT_BALANCE" || code === "AUTH_FAILED";
}

function routerResult(result: QwenImageResult): QwenModelAttempt["routerResult"] {
  if (result.success) return "SUCCESS";
  if (result.errorCode === "QUOTA_EXHAUSTED") return "FREE_TIER_EXHAUSTED";
  if (result.errorCode === "INSUFFICIENT_BALANCE") return "ACCOUNT_ARREARAGE";
  if (result.errorCode === "AUTH_FAILED") return "ACCOUNT_AUTH_FAILED";
  if (result.errorCode === "MODEL_NOT_AVAILABLE" || result.errorCode === "MODEL_TEMPORARILY_UNAVAILABLE" || result.errorCode === "MODEL_NOT_SUPPORTED_IN_REGION") return "MODEL_UNAVAILABLE";
  return "REQUEST_FAILED";
}

function textModelSize(size: string) {
  const [width, height] = size.split("*").map(Number);
  if (!width || !height) return "928*1664";
  return width > height ? "1664*928" : width === height ? "1328*1328" : "928*1664";
}

export async function generateQwenImageAdaptive(input: QwenImageRequest, onAttempt?: (attempt: QwenModelAttempt) => Promise<void>, call: typeof callQwenImage = callQwenImage): Promise<QwenImageResult> {
  const key = await resolveProviderApiKey("qwen-image", input.sessionId);
  const scope = credentialScope(input.sessionId ?? "", key);
  const state = availability.get(scope) ?? new Map<string, Availability>();
  availability.set(scope, state);
  const referenceCount = (input.referenceImages?.length ? input.referenceImages : input.referenceImage ? [input.referenceImage] : []).length;
  const taskType = input.taskType ?? (referenceCount ? "keyframe_generation" : "scene_candidate_text_only");
  let pool: string[];
  try { pool = selectQwenImageModels({ ...input, taskType }); }
  catch (error) { return { success: false, provider: "dashscope", model: "未选择", latencyMs: 0, size: input.size ?? "1152*2048",
    cacheStatus: "not-requested", errorCode: error instanceof Error && error.message === "REFERENCE_IMAGE_REQUIRED" ? "REFERENCE_IMAGE_REQUIRED" : "MODEL_ROUTING_FAILED",
    error: error instanceof Error ? error.message : String(error) }; }
  const mode = referenceCount ? "reference-image" : "text-to-image";
  const defaults = getAIConfig({ allowSessionSecrets: true }).qwenImage;
  const parameters = { promptExtend: input.promptExtend ?? defaults.promptExtend, watermark: input.watermark ?? defaults.watermark };
  const candidateModels = [...pool];
  const requiredCapabilities = input.requiredCapabilities ?? { referenceImageInput: referenceCount > 0, textToImage: referenceCount === 0 };
  const apiKeyFingerprintMasked = `…${keyFingerprint(key).slice(-8)}`;
  const trace = () => ({ requiredCapabilities, candidateModels, apiKeyFingerprintMasked,
    skippedModels: candidateModels.filter((modelId) => {
      const entry = state.get(modelId);
      return entry?.status === "FREE_TIER_EXHAUSTED" || Boolean(entry?.cooldownUntil && entry.cooldownUntil > Date.now());
    }) });
  let index = 0;
  let last: QwenImageResult | undefined;
  const account = activeAccountHealth(scope);
  if (account?.status === "ARREARAGE" || account?.status === "AUTH_FAILED") {
    const errorCode = account.status === "ARREARAGE" ? "INSUFFICIENT_BALANCE" : "AUTH_FAILED";
    const blocked = { success: false, provider: "dashscope" as const, model: "未调用", latencyMs: 0,
      size: input.size ?? "1152*2048", cacheStatus: "not-requested" as const, errorCode, error: qwenImageUserMessage(errorCode) };
    await onAttempt?.({ taskType, model: "未调用", attempt: 1, status: "blocked", startedAt: Date.now(), completedAt: Date.now(),
      errorCode: "BLOCKED_ACCOUNT_ERROR", error: blocked.error, referenceCount, size: blocked.size, mode,
      routerStage: "ACCOUNT_GATE", blockedReason: account.status === "ARREARAGE" ? "ACCOUNT_ARREARAGE_CACHE_VALID" : "ACCOUNT_AUTH_FAILED_CACHE_VALID",
      accountState: account.status, accountStateSource: "CACHE", accountStateCheckedAt: account.checkedAt,
      accountStateExpiresAt: account.cooldownUntil ?? undefined, ...trace(),
      routerDecision: "STOP_PROVIDER", routerResult: account.status === "ARREARAGE" ? "ACCOUNT_ARREARAGE" : "ACCOUNT_AUTH_FAILED", ...parameters });
    return blocked;
  }

  if (input.resumeTaskId) {
    const startedAt = Date.now();
    const result = await call({ ...input, model: "qwen-image-3.0", onTaskProgress: async (progress) => {
      await input.onTaskProgress?.(progress);
      await onAttempt?.({ taskType, model: "qwen-image-3.0", attempt: 2, status: progress.status === "FAILED" ? "failed" : progress.status === "SUCCEEDED" ? "completed" : "running",
        startedAt: progress.submittedAt, completedAt: Date.now(), requestId: progress.requestId, taskId: progress.taskId,
        referenceCount, size: input.size ?? "1152*2048", mode, providerStatus: progress.status,
        submittedAt: progress.submittedAt, lastPolledAt: progress.lastPolledAt, pollCount: progress.pollCount,
        imageUrl: progress.imageUrl, ...parameters });
    } });
    await onAttempt?.({ taskType, model: "qwen-image-3.0", attempt: 2, status: result.success ? "completed" : result.errorCode === "TASK_POLL_INTERRUPTED" ? "running" : "failed",
      startedAt, completedAt: Date.now(), errorCode: result.errorCode, error: result.error,
      providerErrorCode: result.providerErrorCode, httpStatus: result.httpStatus, requestId: result.requestId,
      taskId: result.taskId, referenceCount, size: input.size ?? "1152*2048", assetId: result.assetId, mode,
      submissionElapsedMs: result.submissionElapsedMs, downloadElapsedMs: result.downloadElapsedMs,
      submissionDiagnostic: result.submissionDiagnostic, networkFailure: result.networkFailure,
      providerOutcome: result.providerOutcome, timeoutSource: result.timeoutSource,
      responseReceivedAt: result.responseReceivedAt, assetPersistedAt: result.assetPersistedAt, ...parameters });
    return result;
  }

  const preferred = pool.find((modelId) => state.get(modelId)?.status === "AVAILABLE");
  if (preferred) pool = [preferred, ...pool.filter((modelId) => modelId !== preferred)];
  for (const modelId of pool) {
    const size = QWEN_TEXT_MODELS.includes(modelId as typeof QWEN_TEXT_MODELS[number]) && modelId !== "qwen-image-2.0-pro-2026-06-22"
      ? textModelSize(input.size ?? "1152*2048") : input.size ?? "1152*2048";
    const now = Date.now();
    const attempt = ++index;
    for (let rateRetry = 0; rateRetry < 3; rateRetry += 1) {
      const attemptNumber = rateRetry ? ++index : attempt;
      const result: QwenImageResult & { routerBlockedFromCache?: boolean } = await withModelSlot(scope, modelId, async () => {
        const accountInQueue = activeAccountHealth(scope);
        if (accountInQueue?.status === "ARREARAGE" || accountInQueue?.status === "AUTH_FAILED") return {
          success: false, provider: "dashscope" as const, model: modelId, latencyMs: 0, size,
          routerBlockedFromCache: true,
          errorCode: accountInQueue.status === "ARREARAGE" ? "INSUFFICIENT_BALANCE" : "AUTH_FAILED",
          error: qwenImageUserMessage(accountInQueue.status === "ARREARAGE" ? "INSUFFICIENT_BALANCE" : "AUTH_FAILED")
        };
        const cached = state.get(modelId);
        if (rateRetry === 0 && cached && (cached.status === "FREE_TIER_EXHAUSTED" || (cached.cooldownUntil ?? 0) > Date.now())) return { success: false, provider: "dashscope" as const, model: modelId,
          latencyMs: 0, size, errorCode: "MODEL_SKIPPED_COOLDOWN", error: cached.status === "FREE_TIER_EXHAUSTED"
            ? "该模型的免费额度已用尽，当前密钥下不再尝试。" : `该模型此前返回 ${cached.code}，冷却至 ${new Date(cached.cooldownUntil!).toISOString()}。` };
        const generated = await call({ ...input, model: modelId, size,
        onSubmissionStart: async (diagnostic) => {
          await input.onSubmissionStart?.(diagnostic);
          await onAttempt?.({ taskType, model: modelId, attempt: attemptNumber, status: "running", startedAt: diagnostic.requestStartedAt,
            completedAt: diagnostic.requestStartedAt, referenceCount, size, mode, submissionDiagnostic: diagnostic,
            routerStage: "PROVIDER_CALL", selectedModel: modelId, providerRequestModel: modelId, ...trace(), ...parameters });
        },
        onTaskProgress: async (progress) => {
          await input.onTaskProgress?.(progress);
          await onAttempt?.({ taskType, model: modelId, attempt: attemptNumber, status: progress.status === "FAILED" ? "failed" : progress.status === "SUCCEEDED" ? "completed" : "running",
            startedAt: progress.submittedAt, completedAt: Date.now(), requestId: progress.requestId, taskId: progress.taskId,
            referenceCount, size, mode, providerStatus: progress.status, submittedAt: progress.submittedAt,
            lastPolledAt: progress.lastPolledAt, pollCount: progress.pollCount, imageUrl: progress.imageUrl, ...parameters });
        } });
        const generatedCode = generated.errorCode as QwenFailureCode | undefined;
        if (generated.success) {
          state.set(modelId, { code: "SUCCESS", status: "AVAILABLE", cooldownUntil: null, lastCheckedAt: Date.now(), apiKeyFingerprint: keyFingerprint(key) });
          providerAccountState.set(scope, { status: "HEALTHY", checkedAt: Date.now(), cooldownUntil: null });
        }
        else if (isAccountError(generatedCode)) providerAccountState.set(scope,
          { status: generatedCode === "INSUFFICIENT_BALANCE" ? "ARREARAGE" : "AUTH_FAILED",
            checkedAt: Date.now(), cooldownUntil: Date.now() + accountHardStopTtlMs() });
        else if (generatedCode && shouldFallbackQwen(generatedCode)) state.set(modelId,
          { code: generatedCode, status: generatedCode === "QUOTA_EXHAUSTED" ? "FREE_TIER_EXHAUSTED" : "TEMP_UNAVAILABLE",
            cooldownUntil: generatedCode === "QUOTA_EXHAUSTED" ? null : Date.now() + availabilityTtl(generatedCode, generated.retryAfterMs),
            lastCheckedAt: Date.now(), apiKeyFingerprint: keyFingerprint(key) });
        else if (generatedCode === "RATE_LIMITED") state.set(modelId,
          { code: generatedCode, status: "RATE_LIMITED", cooldownUntil: Date.now() + availabilityTtl(generatedCode, generated.retryAfterMs),
            lastCheckedAt: Date.now(), apiKeyFingerprint: keyFingerprint(key) });
        return generated;
      });
      if (result.errorCode === "MODEL_SKIPPED_COOLDOWN") {
        await onAttempt?.({ taskType, model: modelId, attempt: attemptNumber, status: "blocked", startedAt: Date.now(), completedAt: Date.now(),
          errorCode: result.errorCode, error: result.error, referenceCount, size, mode, routerDecision: "SKIP_CACHED_MODEL",
          routerStage: "CAPABILITY_FILTER", ...trace(),
          routerResult: state.get(modelId)?.status === "FREE_TIER_EXHAUSTED" ? "FREE_TIER_EXHAUSTED" : "MODEL_UNAVAILABLE", ...parameters });
        break;
      }
      const code = result.errorCode as QwenFailureCode | undefined;
      const decision = result.success ? "SELECT_MODEL" : isAccountError(code) ? "STOP_PROVIDER"
        : code === "RATE_LIMITED" && rateRetry < 2 ? "RETRY_SAME_MODEL"
        : code && shouldFallbackQwen(code) && modelId !== pool.at(-1) ? "FALLBACK_NEXT_MODEL" : "STOP_REQUEST";
      const blockedFromCache = "routerBlockedFromCache" in result && result.routerBlockedFromCache === true;
      const currentAccount = activeAccountHealth(scope);
      await onAttempt?.({ taskType, model: modelId, attempt: attemptNumber, status: blockedFromCache ? "blocked" : result.success ? "completed" : result.errorCode === "TASK_POLL_INTERRUPTED" ? "running" : "failed",
        startedAt: result.requestStartedAt ?? now, completedAt: result.requestCompletedAt ?? Date.now(),
        errorCode: result.errorCode, error: result.error, providerErrorCode: result.providerErrorCode, httpStatus: result.httpStatus,
        requestId: result.requestId, taskId: result.taskId, referenceCount, size, assetId: result.assetId, mode,
        submissionElapsedMs: result.submissionElapsedMs, downloadElapsedMs: result.downloadElapsedMs,
        submissionDiagnostic: result.submissionDiagnostic, networkFailure: result.networkFailure,
        providerOutcome: result.providerOutcome, timeoutSource: result.timeoutSource,
        responseReceivedAt: result.responseReceivedAt, assetPersistedAt: result.assetPersistedAt,
        routerStage: blockedFromCache ? "ACCOUNT_GATE" : "PROVIDER_CALL",
        blockedReason: isAccountError(code) ? code === "INSUFFICIENT_BALANCE"
          ? blockedFromCache ? "ACCOUNT_ARREARAGE_CACHE_VALID" : "ACCOUNT_ARREARAGE_FRESH_PROVIDER_RESPONSE"
          : blockedFromCache ? "ACCOUNT_AUTH_FAILED_CACHE_VALID" : "ACCOUNT_AUTH_FAILED_FRESH_PROVIDER_RESPONSE" : undefined,
        accountState: currentAccount?.status ?? "UNKNOWN", accountStateSource: isAccountError(code) ? blockedFromCache ? "CACHE" : "PROVIDER_RESPONSE" : undefined,
        accountStateCheckedAt: currentAccount?.checkedAt, accountStateExpiresAt: currentAccount?.cooldownUntil ?? undefined,
        ...trace(), providerRequestModel: blockedFromCache ? undefined : modelId,
        fallbackReason: decision === "FALLBACK_NEXT_MODEL" ? code : undefined,
        routerDecision: decision, routerResult: routerResult(result), selectedModel: result.success ? modelId : undefined,
        finalModel: result.success ? result.model : undefined, ...parameters });
      if (result.success) return result;
      last = result;
      if (code === "RATE_LIMITED" && rateRetry < 2) {
        const delay = Math.min(60_000, Math.max(1_000, result.retryAfterMs ?? (modelId.includes("max") || modelId.includes("2.0-pro") ? 30_000 : 2_000)));
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (code === "RATE_LIMITED") return result;
      if (!code || !shouldFallbackQwen(code)) return result;
      break;
    }
  }
  if (pool.every((modelId) => state.get(modelId)?.status === "FREE_TIER_EXHAUSTED")) return {
    success: false, provider: "dashscope", model: pool.at(-1) ?? "未选择", latencyMs: 0,
    size: input.size ?? "1152*2048", cacheStatus: "not-requested", errorCode: "QUOTA_EXHAUSTED", error: qwenImageUserMessage("QUOTA_EXHAUSTED") };
  return last ?? { success: false, provider: "dashscope", model: pool[0] ?? "未选择",
    latencyMs: 0, size: input.size ?? "1152*2048", cacheStatus: "not-requested", errorCode: "MODEL_NOT_AVAILABLE",
    error: "当前图像模型免费额度已用尽或模型暂不可用，系统已尝试其它可用模型；请检查模型设置或更换可用模型账户。" };
}

export async function inspectQwenImageModels(sessionId: string) {
  const key = await resolveProviderApiKey("qwen-image", sessionId);
  const baseUrl = getAIConfig({ allowSessionSecrets: true }).qwenImage.baseUrl;
  const connection = await diagnoseDashScopeConnection(baseUrl, key ?? undefined);
  const scope = credentialScope(sessionId, key);
  const cached = availability.get(scope);
  const accountHealth = activeAccountHealth(scope)?.status ?? "UNKNOWN";
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
  return { notice, connection, freeOnly: QWEN_FREE_ONLY, accountHealth, models: QWEN_IMAGE_CANDIDATES.map((candidate) => {
    const state = cached?.get(candidate.modelId);
    const cooling = state && (state.status === "FREE_TIER_EXHAUSTED" || (state.cooldownUntil ?? 0) > Date.now()) ? state : undefined;
    return { ...candidate, status: !key ? "unknown" : cooling ? "unavailable" : listed?.has(candidate.modelId) ? "available" : "unknown",
      availabilityStatus: state?.status ?? "UNKNOWN", apiKeyFingerprint: state?.apiKeyFingerprint ?? keyFingerprint(key),
      reason: cooling ? state!.status === "FREE_TIER_EXHAUSTED" ? "当前密钥下该模型免费额度已用尽。" : qwenImageUserMessage(cooling.code)
        : listed?.has(candidate.modelId) ? "模型列表已列出，额度待首次生成验证。" : "未在当前响应中确认；首次生成时检测。",
      lastCheckedAt: state?.lastCheckedAt ?? null, cooldownUntil: cooling?.cooldownUntil ?? null };
  }) };
}
