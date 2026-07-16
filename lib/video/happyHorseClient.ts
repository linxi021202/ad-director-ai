import { getAIConfig } from "../config/ai";
import { assertServerOnly } from "../server-only";
import { resolveProviderApiKey } from "../secrets/resolver";
import { sanitizeVideoError } from "./downloadVideo";
import type { HappyHorseVideoRequest, HappyHorseVideoResult } from "./types";
import { appendNoReadableTextRules } from "../prompts/noReadableText";

assertServerOnly("HappyHorse video client");

const DEFAULT_GENERATION_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const TASK_PATH = "/api/v1/tasks";
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 60;

export async function generateHappyHorseVideo(input: HappyHorseVideoRequest): Promise<HappyHorseVideoResult> {
  const startedAt = Date.now();
  const config = getAIConfig({ allowSessionSecrets: true });
  const model = input.model ?? config.video.happyHorseModel;

  if (!config.realVideoEnabled) {
    return fail(model, startedAt, "HappyHorse 真实调用未启用：请设置 ENABLE_REAL_VIDEO=true。");
  }
  if (!/-r2v$/i.test(model)) {
    return fail(model, startedAt, `当前请求包含多张参考图，只能使用 HappyHorse r2v 模型；当前配置为 ${model}。`);
  }
  if (!input.referenceImages.some((image) => image.role === "product")) {
    return fail(model, startedAt, "HappyHorse r2v 调用已阻止：缺少用户上传的真实产品参考图。");
  }

  const apiKey = await resolveProviderApiKey("happyhorse", input.sessionId);
  if (!apiKey) {
    return fail(model, startedAt, "HappyHorse 真实调用缺少百炼 Key：请在模型设置中保存并验证 DashScope API Key。");
  }

  try {
    const createUrl = buildUrl(
      config.video.happyHorseBaseUrl,
      process.env.HAPPYHORSE_GENERATION_PATH || DEFAULT_GENERATION_PATH
    );
    const createResponse = await fetch(createUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable"
      },
      body: JSON.stringify(buildHappyHorseRequestBody(input, model)),
      cache: "no-store"
    });
    const createJson = await readJson(createResponse);
    if (!createResponse.ok) {
      return fail(model, startedAt, extractApiError(createJson, createResponse.status));
    }

    const requestId = extractRequestId(createJson);
    const immediateVideoUrl = extractVideoUrl(createJson);
    if (immediateVideoUrl) {
      return {
        success: true,
        provider: "dashscope",
        model,
        requestId,
        remoteVideoUrl: immediateVideoUrl,
        latencyMs: Date.now() - startedAt
      };
    }

    const taskId = extractTaskId(createJson);
    if (!taskId) {
      return fail(model, startedAt, `HappyHorse 未返回 task_id 或视频地址：${safeJsonPreview(createJson)}`);
    }

    return await pollHappyHorseTask({
      baseUrl: config.video.happyHorseBaseUrl,
      apiKey,
      model,
      taskId,
      requestId,
      startedAt
    });
  } catch (error) {
    return fail(model, startedAt, sanitizeVideoError(error));
  }
}

export function buildHappyHorseRequestBody(input: HappyHorseVideoRequest, model: string) {
  const productCount = input.referenceImages.filter((image) => image.role === "product").length;
  const referenceGuide = input.referenceImages
    .map((image, index) => image.role === "product"
      ? `[Image ${index + 1}] 是用户上传的真实产品图，仅作为包装结构、颜色、材质和比例参考；不得合成或重绘可读包装文字与 Logo 文字`
      : `[Image ${index + 1}] 是当前主镜头关键帧，仅用于参考场景构图、机位和光线`)
    .join("；");

  return {
    model,
    input: {
      prompt: appendNoReadableTextRules([
        `参考图规则：${referenceGuide}。`,
        `共 ${productCount} 张真实产品参考图。视频中的商品外观必须来自这些参考图，不得虚构或替换商品；模型不得合成、重绘或修改任何可读包装文字。`,
        "保持主体构图稳定，不新增人物，不生成额外产品。真实广告标题、卖点、字幕和 CTA 全部由 Remotion 后期叠加。",
        `镜头要求：${input.prompt}`
      ].join("\n")),
      media: input.referenceImages.map((image) => ({
        type: "reference_image",
        url: image.url
      }))
    },
    parameters: {
      resolution: process.env.HAPPYHORSE_VIDEO_RESOLUTION || "720P",
      ratio: input.aspectRatio,
      duration: Math.max(3, Math.min(5, Math.round(input.durationSec))),
      watermark: false
    }
  };
}

async function pollHappyHorseTask(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  taskId: string;
  requestId?: string;
  startedAt: number;
}): Promise<HappyHorseVideoResult> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    await delay(POLL_INTERVAL_MS);
    const response = await fetch(buildUrl(input.baseUrl, `${TASK_PATH}/${encodeURIComponent(input.taskId)}`), {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      cache: "no-store"
    });
    const json = await readJson(response);
    if (!response.ok) {
      return fail(input.model, input.startedAt, extractApiError(json, response.status), input.taskId, input.requestId);
    }

    const status = extractTaskStatus(json);
    const videoUrl = extractVideoUrl(json);
    if (videoUrl && ["SUCCEEDED", "SUCCESS", "COMPLETED", "FINISHED"].includes(status)) {
      return {
        success: true,
        provider: "dashscope",
        model: input.model,
        taskId: input.taskId,
        requestId: extractRequestId(json) ?? input.requestId,
        remoteVideoUrl: videoUrl,
        latencyMs: Date.now() - input.startedAt
      };
    }
    if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(status)) {
      return fail(input.model, input.startedAt, extractApiError(json, 502), input.taskId, input.requestId);
    }
  }

  return fail(
    input.model,
    input.startedAt,
    "HappyHorse 视频任务轮询超过 5 分钟。任务可能仍在百炼处理中，请稍后重试或在百炼控制台查看任务状态。",
    input.taskId,
    input.requestId
  );
}

function buildUrl(baseUrl: string, pathValue: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${pathValue.replace(/^\/+/, "")}`;
}

async function readJson(response: Response) {
  const responseText = await response.text();
  if (!responseText) return null;
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return { message: responseText.slice(0, 500) };
  }
}

function extractTaskId(value: unknown) {
  return findStringByKeys(value, ["task_id", "taskId", "task"]);
}

function extractRequestId(value: unknown) {
  return findStringByKeys(value, ["request_id", "requestId"]);
}

function extractTaskStatus(value: unknown) {
  return (findStringByKeys(value, ["task_status", "taskStatus", "status"]) ?? "").toUpperCase();
}

function extractVideoUrl(value: unknown) {
  return findStringsByKeys(value, ["video_url", "videoUrl", "url", "file_url", "output_url", "resource_url"])
    .find((item) => /^https?:\/\//i.test(item) && isLikelyVideoUrl(item));
}

function isLikelyVideoUrl(value: string) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(value) || /video|oss|aliyun|dashscope/i.test(value);
}

function extractApiError(value: unknown, status: number) {
  const code = findStringByKeys(value, ["code", "error_code", "Code"]);
  const message = findStringByKeys(value, ["message", "error_message", "Message"]) ?? safeJsonPreview(value);
  return sanitizeVideoError(`DashScope HappyHorse HTTP ${status}${code ? ` ${code}` : ""}: ${message}`);
}

function findStringByKeys(value: unknown, keys: string[]) {
  return findStringsByKeys(value, keys)[0];
}

function findStringsByKeys(value: unknown, keys: string[]) {
  const results: string[] = [];
  walk(value, (key, item) => {
    if (keys.includes(key) && typeof item === "string" && item.trim()) results.push(item.trim());
  });
  return results;
}

function walk(value: unknown, visit: (key: string, item: unknown) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visit(String(index), item);
      walk(item, visit);
    });
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    visit(key, item);
    walk(item, visit);
  });
}

function safeJsonPreview(value: unknown) {
  return sanitizeVideoError(JSON.stringify(value ?? {}).slice(0, 500));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(
  model: string,
  startedAt: number,
  error: string,
  taskId?: string,
  requestId?: string
): HappyHorseVideoResult {
  return {
    success: false,
    provider: "dashscope",
    model,
    taskId,
    requestId,
    latencyMs: Date.now() - startedAt,
    error: sanitizeVideoError(error)
  };
}
