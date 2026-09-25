import { getAIConfig } from "../config/ai";
import { resolveProviderApiKey } from "../secrets/resolver";
import { downloadGeneratedImage } from "./downloadImage";
import { estimateQwenImageCost } from "./imageCostEstimate";
import { classifyQwenFailure } from "./qwenImageErrors";
import { classifySubmissionFailure, describeDashScopeEndpoint } from "./dashscopeDiagnostics";
import type { QwenImageRequest, QwenImageResult, QwenNetworkFailure, QwenSubmissionDiagnostic, QwenTaskProgress } from "./types";

const QWEN_IMAGE_PATH = "/api/v1/services/aigc/multimodal-generation/generation";
const QWEN_IMAGE_ASYNC_PATH = "/api/v1/services/aigc/image-generation/generation";
const QWEN_TASK_PATH = "/api/v1/tasks";
const TASK_POLL_INTERVAL_MS = 3000;
const GENERATION_TIMEOUT_MS = 30 * 60_000;
const SYNC_TIMEOUT_MS = Math.max(120_000, Number(process.env.QWEN_IMAGE_SYNC_TIMEOUT_MS) || 300_000);

export function buildQwenImageContent(input: Pick<QwenImageRequest, "prompt" | "referenceImage" | "referenceImages">) {
  const references = (input.referenceImages?.length ? input.referenceImages : input.referenceImage ? [input.referenceImage] : [])
    .filter(Boolean)
    .slice(0, 3);
  return [...references.map((image) => ({ image })), { text: input.prompt }];
}

export function buildQwenImageRequestBody(input: QwenImageRequest, model: string, size: string, defaults: { promptExtend: boolean; watermark: boolean }) {
  return {
    model,
    input: { messages: [{ role: "user", content: buildQwenImageContent(input) }] },
    parameters: {
      negative_prompt: input.negativePrompt,
      prompt_extend: input.promptExtend ?? defaults.promptExtend,
      watermark: input.watermark ?? defaults.watermark,
      size,
      n: 1 as const
    }
  };
}

function hasImageReference(input: Pick<QwenImageRequest, "referenceImage" | "referenceImages">) {
  return Boolean(input.referenceImage || input.referenceImages?.length);
}

function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error("callQwenImage can only be called on the server.");
  }
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
  return raw
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/data:image\/\S+/gi, "[redacted-image]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .slice(0, 420);
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || !(key in value)) {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" && property.length > 0 ? property : undefined;
}

function walkObjects(payload: unknown): unknown[] {
  const seen = new Set<unknown>();
  const stack: unknown[] = [payload];
  const output: unknown[] = [];

  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }

    seen.add(current);
    output.push(current);

    if (Array.isArray(current)) {
      stack.push(...current);
    } else {
      stack.push(...Object.values(current as Record<string, unknown>));
    }
  }

  return output;
}

function isHttpImageUrl(value: string): boolean {
  return /^https?:\/\//.test(value) && (/\.(png|jpe?g|webp)(\?|$)/i.test(value) || /oss|dashscope|aliyun|image|generated/i.test(value));
}

function extractImageUrl(payload: unknown): string | undefined {
  const preferredKeys = new Set([
    "url",
    "image_url",
    "imageUrl",
    "image",
    "image_url",
    "result_url",
    "resource_url",
    "oss_url",
    "file_url",
    "output_url"
  ]);

  for (const current of walkObjects(payload)) {
    if (Array.isArray(current)) {
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of preferredKeys) {
      const candidate = record[key];
      if (typeof candidate === "string" && isHttpImageUrl(candidate)) {
        return candidate;
      }
    }
  }

  for (const current of walkObjects(payload)) {
    if (Array.isArray(current)) {
      continue;
    }

    for (const [key, candidate] of Object.entries(current as Record<string, unknown>)) {
      if (typeof candidate === "string" && /url|image|file|resource/i.test(key) && isHttpImageUrl(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function extractRequestId(payload: unknown): string | undefined {
  for (const current of walkObjects(payload)) {
    const requestId = getStringProperty(current, "request_id") ?? getStringProperty(current, "requestId");
    if (requestId) return requestId;
  }

  return undefined;
}

function extractTaskId(payload: unknown): string | undefined {
  for (const current of walkObjects(payload)) {
    const taskId = getStringProperty(current, "task_id") ?? getStringProperty(current, "taskId");
    if (taskId) return taskId;
  }

  return undefined;
}

function extractTaskStatus(payload: unknown): string | undefined {
  for (const current of walkObjects(payload)) {
    const status =
      getStringProperty(current, "task_status") ??
      getStringProperty(current, "taskStatus") ??
      getStringProperty(current, "status");
    if (status) return status;
  }

  return undefined;
}

function extractApiError(payload: unknown): string | undefined {
  const code = getStringProperty(payload, "code");
  const message = getStringProperty(payload, "message");

  if (code || message) {
    return [code, message].filter(Boolean).join(": ");
  }

  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") {
      return error;
    }

    if (error && typeof error === "object") {
      const errorCode = getStringProperty(error, "code");
      const errorMessage = getStringProperty(error, "message");
      return [errorCode, errorMessage].filter(Boolean).join(": ") || undefined;
    }
  }

  for (const current of walkObjects(payload)) {
    const status = extractTaskStatus(current);
    const taskMessage = getStringProperty(current, "message") ?? getStringProperty(current, "error_message");
    if (status && /failed|error|canceled|cancelled/i.test(status)) {
      return [status, taskMessage].filter(Boolean).join(": ");
    }
  }

  return undefined;
}

type TaskPollResult = {
  payload?: unknown;
  imageUrl?: string;
  requestId?: string;
  error?: string;
  errorCode?: string;
  providerErrorCode?: string;
  httpStatus?: number;
  retryAfterMs?: number;
};

function providerCode(payload: unknown): string | undefined {
  return getStringProperty(payload, "code") || (payload && typeof payload === "object" && "error" in payload
    ? getStringProperty((payload as { error?: unknown }).error, "code") : undefined);
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, Math.round(delay)) : undefined;
}

async function pollQwenImageTask(baseUrl: string, apiKey: string, taskId: string, onProgress?: QwenImageRequest["onTaskProgress"], submittedAt = Date.now()): Promise<TaskPollResult> {
  let pollCount = 0;
  let transientErrors = 0;
  while (Date.now() - submittedAt < GENERATION_TIMEOUT_MS) {
    let response: Response;
    try {
      response = await fetch(joinUrl(baseUrl, `${QWEN_TASK_PATH}/${encodeURIComponent(taskId)}`), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }, signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      if (++transientErrors >= 3) return { error: sanitizeErrorMessage(error), errorCode: "TASK_POLL_INTERRUPTED" };
      await sleep(TASK_POLL_INTERVAL_MS);
      continue;
    }
    pollCount += 1;

    const payload = (await response.json().catch(() => null)) as unknown;
    const requestId = extractRequestId(payload);
    const apiError = extractApiError(payload);

    if (!response.ok || apiError) {
      if (response.status >= 500 && ++transientErrors < 3) { await sleep(TASK_POLL_INTERVAL_MS); continue; }
      if (/failed|error|canceled|cancelled/i.test(extractTaskStatus(payload) ?? "")) {
        await onProgress?.({ taskId, requestId, status: "FAILED", submittedAt, lastPolledAt: Date.now(), pollCount });
      }
      return {
        payload,
        requestId,
        error: sanitizeErrorMessage(apiError || `DashScope task query failed with HTTP ${response.status}.`),
        errorCode: response.status >= 500 ? "TASK_POLL_INTERRUPTED" : classifyQwenFailure(response.status, providerCode(payload), apiError || ""),
        providerErrorCode: providerCode(payload), httpStatus: response.status, retryAfterMs: retryAfterMs(response)
      };
    }

    const imageUrl = extractImageUrl(payload);
    const status = extractTaskStatus(payload);
    const progress: QwenTaskProgress = { taskId, requestId, status: imageUrl ? "SUCCEEDED" : /failed|error|canceled|cancelled/i.test(status ?? "") ? "FAILED" : /running/i.test(status ?? "") ? "RUNNING" : "PENDING",
      submittedAt, lastPolledAt: Date.now(), pollCount, ...(imageUrl ? { imageUrl } : {}) };
    await onProgress?.(progress);
    if (imageUrl) {
      return { payload, imageUrl, requestId };
    }

    if (status && /succeeded|success|completed/i.test(status)) {
      return {
        payload,
        requestId,
        error: `DashScope task ${taskId} succeeded but did not include a supported image URL field.`, errorCode: "PROVIDER_ERROR"
      };
    }

    if (status && /failed|error|canceled|cancelled/i.test(status)) {
      return {
        payload,
        requestId,
        error: `DashScope task ${taskId} ended with status ${status}.`, errorCode: classifyQwenFailure(undefined, providerCode(payload), apiError || taskMessage(payload) || status), providerErrorCode: providerCode(payload)
      };
    }

    transientErrors = 0;
    await sleep(TASK_POLL_INTERVAL_MS);
  }

  return {
    error: `DashScope task ${taskId} is still running after the local polling window.`, errorCode: "TASK_POLL_INTERRUPTED"
  };
}

function taskMessage(payload: unknown) { return getStringProperty(payload, "message") ?? getStringProperty(payload, "error_message"); }

async function cacheImageIfNeeded(
  input: QwenImageRequest,
  imageUrl: string
): Promise<Pick<QwenImageResult, "assetId" | "localUrl" | "cacheStatus" | "error"> & { failureStage?: "download" | "persist" }> {
  if (!input.projectId || !input.shotId) return { cacheStatus: "remote-only" };
  const download = await downloadGeneratedImage({
    imageUrl,
    projectId: input.projectId,
    shotId: input.shotId,
    sessionId: input.sessionId
  });
  return {
    assetId: download.assetId,
    localUrl: download.localUrl,
    cacheStatus: download.cacheStatus,
    error: download.error,
    failureStage: download.failureStage
  };
}
export async function callQwenImage(input: QwenImageRequest): Promise<QwenImageResult> {
  assertServerOnly();

  const startedAt = Date.now();
  let requestStartedAt: number | undefined;
  let requestCompletedAt: number | undefined;
  let submissionElapsedMs: number | undefined;
  let model = input.model || "qwen-image";
  let size = input.size || "1152*2048";
  let knownTaskId = input.resumeTaskId;
  let submissionDiagnostic: QwenSubmissionDiagnostic | undefined;
  let networkFailure: QwenNetworkFailure | undefined;
  let submissionPhase: "WAITING_RESPONSE" | "JSON_PARSE" = "WAITING_RESPONSE";

  try {
    const config = getAIConfig({ allowSessionSecrets: true });
    model = hasImageReference(input)
      ? input.model || process.env.QWEN_IMAGE_EDIT_MODEL || "qwen-image-2.0"
      : input.model || config.qwenImage.imageModel;
    size = input.size || config.qwenImage.size;

    if (!config.realImageEnabled) {
      return {
        success: false,
        provider: "dashscope",
        model,
        latencyMs: Date.now() - startedAt,
        size,
        cacheStatus: "not-requested",
        costEstimate: estimateQwenImageCost(size),
        error: "ENABLE_REAL_IMAGE must be true before calling Qwen-Image.", errorCode: "PROVIDER_NOT_CONFIGURED"
      };
    }

    const apiKey = await resolveProviderApiKey("qwen-image", input.sessionId);

    if (!apiKey) {
      return {
        success: false,
        provider: "dashscope",
        model,
        latencyMs: Date.now() - startedAt,
        size,
        cacheStatus: "not-requested",
        costEstimate: estimateQwenImageCost(size),
        error: "DASHSCOPE_API_KEY is required when ENABLE_REAL_IMAGE=true.", errorCode: "PROVIDER_NOT_CONFIGURED"
      };
    }

    const isAsync = model === "qwen-image-3.0";
    const path = isAsync ? QWEN_IMAGE_ASYNC_PATH : QWEN_IMAGE_PATH;
    const body = JSON.stringify(buildQwenImageRequestBody(input, model, size, {
      promptExtend: config.qwenImage.promptExtend,
      watermark: config.qwenImage.watermark
    }));
    if (!input.resumeTaskId) {
      submissionDiagnostic = {
        ...describeDashScopeEndpoint(config.qwenImage.baseUrl, path),
        apiMode: isAsync ? "dashscope-async" : "dashscope-sync",
        payloadBytes: Buffer.byteLength(body), timeoutMs: isAsync ? config.qwenImage.submissionTimeoutMs : SYNC_TIMEOUT_MS,
        referenceTypes: (input.referenceImages?.length ? input.referenceImages : input.referenceImage ? [input.referenceImage] : [])
          .map((reference) => reference.startsWith("data:") ? "data-url" : reference.startsWith("http") ? "remote-url" : "base64"),
        requestStartedAt: Date.now()
      };
      await input.onSubmissionStart?.(submissionDiagnostic);
      requestStartedAt = Date.now();
    }
    const response = input.resumeTaskId ? undefined : await fetch(joinUrl(config.qwenImage.baseUrl, path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(isAsync ? { "X-DashScope-Async": "enable" } : {})
      },
      body, signal: AbortSignal.timeout(isAsync ? config.qwenImage.submissionTimeoutMs : SYNC_TIMEOUT_MS)
    });

    submissionPhase = "JSON_PARSE";
    const payload = response ? await response.json() as unknown : null;
    submissionPhase = "WAITING_RESPONSE";
    if (response && requestStartedAt) submissionElapsedMs = Date.now() - requestStartedAt;
    const apiError = extractApiError(payload);

    if (response && (!response.ok || apiError)) {
      requestCompletedAt = Date.now();
      return {
        success: false,
        requestId: extractRequestId(payload),
        provider: "dashscope",
        model,
        latencyMs: Date.now() - startedAt,
        size,
        cacheStatus: "not-requested",
        costEstimate: estimateQwenImageCost(size),
        error: sanitizeErrorMessage(apiError || `DashScope Qwen-Image request failed with HTTP ${response.status}.`),
        errorCode: classifyQwenFailure(response.status, providerCode(payload), apiError || ""),
        providerErrorCode: providerCode(payload), httpStatus: response.status, retryAfterMs: retryAfterMs(response), requestStartedAt, requestCompletedAt, submissionElapsedMs, submissionDiagnostic,
        networkFailure: { failurePhase: "HTTP_RESPONSE" }
      };
    }

    const directImageUrl = extractImageUrl(payload);
    const taskId = input.resumeTaskId ?? extractTaskId(payload);
    knownTaskId = taskId;
    let imageUrl = directImageUrl;
    let requestId = extractRequestId(payload);

    if (!imageUrl && taskId) {
      const submittedAt = Date.now();
      if (!input.resumeTaskId) await input.onTaskProgress?.({ taskId, requestId, status: "PENDING", submittedAt, pollCount: 0 });
      const taskResult = await pollQwenImageTask(config.qwenImage.baseUrl, apiKey, taskId, input.onTaskProgress, submittedAt);
      if (taskResult.error) {
        requestCompletedAt = Date.now();
        return {
          success: false,
          requestId: taskResult.requestId ?? requestId,
          provider: "dashscope",
          model,
          latencyMs: Date.now() - startedAt,
          size,
          cacheStatus: "not-requested",
          costEstimate: estimateQwenImageCost(size),
          error: sanitizeErrorMessage(taskResult.error), errorCode: taskResult.errorCode,
          providerErrorCode: taskResult.providerErrorCode, httpStatus: taskResult.httpStatus, taskId,
          retryAfterMs: taskResult.retryAfterMs, requestStartedAt, requestCompletedAt, submissionElapsedMs, submissionDiagnostic
        };
      }

      imageUrl = taskResult.imageUrl;
      requestId = taskResult.requestId ?? requestId;
    }

    if (!imageUrl) {
      requestCompletedAt = Date.now();
      return {
        success: false,
        requestId,
        provider: "dashscope",
        model,
        latencyMs: Date.now() - startedAt,
        size,
        cacheStatus: "not-requested",
        costEstimate: estimateQwenImageCost(size),
        error: "DashScope Qwen-Image response did not include an image URL or task_id.", errorCode: "PROVIDER_ERROR",
        httpStatus: response?.status, taskId, requestStartedAt, requestCompletedAt, submissionElapsedMs, submissionDiagnostic
      };
    }

    requestCompletedAt = Date.now();
    const downloadStartedAt = Date.now();
    const cached = await cacheImageIfNeeded(input, imageUrl);
    const downloadElapsedMs = input.projectId && input.shotId ? Date.now() - downloadStartedAt : undefined;
    if (input.projectId && input.shotId && (!cached.assetId || cached.cacheStatus !== "cached")) {
      return {
        success: false,
        requestId,
        provider: "dashscope",
        model,
        latencyMs: Date.now() - startedAt,
        size,
        cacheStatus: cached.cacheStatus,
        costEstimate: estimateQwenImageCost(size),
        error: sanitizeErrorMessage(cached.error || "Generated image could not be persisted privately."),
        errorCode: cached.failureStage === "download" ? "ASSET_DOWNLOAD_FAILED" : "ASSET_PERSIST_FAILED",
        httpStatus: response?.status, taskId, requestStartedAt, requestCompletedAt, submissionElapsedMs, downloadElapsedMs, submissionDiagnostic
      };
    }

    return {
      success: true,
      imageUrl,
      assetId: cached.assetId,
      localUrl: cached.localUrl,
      requestId,
      provider: "dashscope",
      model,
      latencyMs: Date.now() - startedAt,
      size,
      cacheStatus: cached.cacheStatus,
      costEstimate: estimateQwenImageCost(size),
      referenceUsed: hasImageReference(input), httpStatus: response?.status, taskId, requestStartedAt, requestCompletedAt, submissionElapsedMs, downloadElapsedMs, submissionDiagnostic
    };
  } catch (error) {
    networkFailure = requestStartedAt && !knownTaskId ? classifySubmissionFailure(error, submissionPhase) : undefined;
    return {
      success: false,
      provider: "dashscope",
      model,
      latencyMs: Date.now() - startedAt,
      size,
      cacheStatus: "not-requested",
      costEstimate: estimateQwenImageCost(size),
      error: sanitizeErrorMessage(error),
      errorCode: knownTaskId ? "TASK_POLL_INTERRUPTED" : requestStartedAt ? "SUBMISSION_STATE_UNKNOWN" : classifyQwenFailure(undefined, undefined, sanitizeErrorMessage(error)),
      taskId: knownTaskId, requestStartedAt, requestCompletedAt: Date.now(), submissionElapsedMs, submissionDiagnostic, networkFailure
    };
  }
}




