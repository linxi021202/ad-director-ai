import { getAIConfig } from "../config/ai";
import { resolveProviderApiKey } from "../secrets/resolver";
import { downloadGeneratedImage } from "./downloadImage";
import { estimateQwenImageCost } from "./imageCostEstimate";
import type { QwenImageRequest, QwenImageResult } from "./types";

const QWEN_IMAGE_PATH = "/api/v1/services/aigc/multimodal-generation/generation";
const QWEN_TASK_PATH = "/api/v1/tasks";
const TASK_POLL_INTERVAL_MS = 1500;
const TASK_POLL_MAX_ATTEMPTS = 24;

export function buildQwenImageContent(input: Pick<QwenImageRequest, "prompt" | "referenceImage">) {
  return input.referenceImage
    ? [{ image: input.referenceImage }, { text: input.prompt }]
    : [{ text: input.prompt }];
}

function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error("callQwenImage can only be called on the server.");
  }
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
  return raw
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
};

async function pollQwenImageTask(baseUrl: string, apiKey: string, taskId: string): Promise<TaskPollResult> {
  for (let attempt = 1; attempt <= TASK_POLL_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(joinUrl(baseUrl, `${QWEN_TASK_PATH}/${encodeURIComponent(taskId)}`), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    const requestId = extractRequestId(payload);
    const apiError = extractApiError(payload);

    if (!response.ok || apiError) {
      return {
        payload,
        requestId,
        error: sanitizeErrorMessage(apiError || `DashScope task query failed with HTTP ${response.status}.`)
      };
    }

    const imageUrl = extractImageUrl(payload);
    if (imageUrl) {
      return { payload, imageUrl, requestId };
    }

    const status = extractTaskStatus(payload);
    if (status && /succeeded|success|completed/i.test(status)) {
      return {
        payload,
        requestId,
        error: `DashScope task ${taskId} succeeded but did not include a supported image URL field.`
      };
    }

    if (status && /failed|error|canceled|cancelled/i.test(status)) {
      return {
        payload,
        requestId,
        error: `DashScope task ${taskId} ended with status ${status}.`
      };
    }

    await sleep(TASK_POLL_INTERVAL_MS);
  }

  return {
    error: `DashScope task ${taskId} did not finish within ${Math.round((TASK_POLL_INTERVAL_MS * TASK_POLL_MAX_ATTEMPTS) / 1000)} seconds.`
  };
}

async function cacheImageIfNeeded(
  input: QwenImageRequest,
  imageUrl: string
): Promise<Pick<QwenImageResult, "assetId" | "localUrl" | "cacheStatus" | "error">> {
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
    error: download.error
  };
}
export async function callQwenImage(input: QwenImageRequest): Promise<QwenImageResult> {
  assertServerOnly();

  const startedAt = Date.now();
  let model = input.model || "qwen-image";
  let size = input.size || "1152*2048";

  try {
    const config = getAIConfig({ allowSessionSecrets: true });
    model = input.referenceImage
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
        error: "ENABLE_REAL_IMAGE must be true before calling Qwen-Image."
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
        error: "DASHSCOPE_API_KEY is required when ENABLE_REAL_IMAGE=true."
      };
    }

    const response = await fetch(joinUrl(config.qwenImage.baseUrl, QWEN_IMAGE_PATH), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: {
          messages: [
            {
              role: "user",
              content: buildQwenImageContent(input)
            }
          ]
        },
        parameters: {
          negative_prompt: input.negativePrompt,
          prompt_extend: input.promptExtend ?? config.qwenImage.promptExtend,
          watermark: input.watermark ?? config.qwenImage.watermark,
          size,
          n: 1
        }
      })
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    const apiError = extractApiError(payload);

    if (!response.ok || apiError) {
      return {
        success: false,
        requestId: extractRequestId(payload),
        provider: "dashscope",
        model,
        latencyMs: Date.now() - startedAt,
        size,
        cacheStatus: "not-requested",
        costEstimate: estimateQwenImageCost(size),
        error: sanitizeErrorMessage(apiError || `DashScope Qwen-Image request failed with HTTP ${response.status}.`)
      };
    }

    const directImageUrl = extractImageUrl(payload);
    const taskId = extractTaskId(payload);
    let imageUrl = directImageUrl;
    let requestId = extractRequestId(payload);

    if (!imageUrl && taskId) {
      const taskResult = await pollQwenImageTask(config.qwenImage.baseUrl, apiKey, taskId);
      if (taskResult.error) {
        return {
          success: false,
          requestId: taskResult.requestId ?? requestId,
          provider: "dashscope",
          model,
          latencyMs: Date.now() - startedAt,
          size,
          cacheStatus: "not-requested",
          costEstimate: estimateQwenImageCost(size),
          error: sanitizeErrorMessage(taskResult.error)
        };
      }

      imageUrl = taskResult.imageUrl;
      requestId = taskResult.requestId ?? requestId;
    }

    if (!imageUrl) {
      return {
        success: false,
        requestId,
        provider: "dashscope",
        model,
        latencyMs: Date.now() - startedAt,
        size,
        cacheStatus: "not-requested",
        costEstimate: estimateQwenImageCost(size),
        error: "DashScope Qwen-Image response did not include an image URL or task_id."
      };
    }

    const cached = await cacheImageIfNeeded(input, imageUrl);
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
        error: sanitizeErrorMessage(cached.error || "Generated image could not be persisted privately.")
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
      referenceUsed: Boolean(input.referenceImage)
    };
  } catch (error) {
    return {
      success: false,
      provider: "dashscope",
      model,
      latencyMs: Date.now() - startedAt,
      size,
      cacheStatus: "not-requested",
      costEstimate: estimateQwenImageCost(size),
      error: sanitizeErrorMessage(error)
    };
  }
}




