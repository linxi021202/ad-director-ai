import { getAIConfig } from "../config/ai";
import {
  appendNoReadableTextRules,
  NO_READABLE_TEXT_NEGATIVE
} from "../prompts/noReadableText";
import { assertServerOnly } from "../server-only";
import { resolveProviderApiKey } from "../secrets/resolver";
import { sanitizeVideoError } from "./downloadVideo";
import type { WanVideoRequest, WanVideoResult } from "./types";

assertServerOnly("Wan 2.7 video client");

const GENERATION_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const TASK_PATH = "/api/v1/tasks";
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 60;

export async function generateWanVideo(input: WanVideoRequest): Promise<WanVideoResult> {
  const startedAt = Date.now();
  const config = getAIConfig({ allowSessionSecrets: true });
  const model = input.model ?? config.video.model;

  if (!config.realVideoEnabled) {
    return fail(model, startedAt, "Wan 2.7 真实调用未启用：请设置 ENABLE_REAL_VIDEO=true。");
  }
  if (!/^wan2\.7-r2v(?:-|$)/i.test(model)) {
    return fail(model, startedAt, `当前多参考生成必须使用 Wan 2.7 R2V；当前配置为 ${model}。`);
  }
  if (!input.referenceImages.some((image) => image.role === "scene")) {
    return fail(model, startedAt, "Wan 2.7 R2V 调用已阻止：缺少当前镜头关键帧。");
  }
  if (!input.referenceImages.some((image) => image.role === "product")) {
    return fail(model, startedAt, "Wan 2.7 R2V 调用已阻止：缺少用户上传的真实产品参考图。");
  }

  const apiKey = await resolveProviderApiKey("wan", input.sessionId);
  if (!apiKey) {
    return fail(model, startedAt, "Wan 2.7 真实调用缺少百炼 Key：请在模型设置中保存并验证 DashScope API Key。");
  }

  try {
    const createResponse = await fetch(buildUrl(config.video.baseUrl, GENERATION_PATH), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable"
      },
      body: JSON.stringify(buildWanRequestBody(input, model, config.video.resolution)),
      cache: "no-store"
    });
    const createJson = await readJson(createResponse);
    if (!createResponse.ok) {
      return fail(model, startedAt, extractApiError(createJson, createResponse.status));
    }

    const requestId = findStringByKeys(createJson, ["request_id", "requestId"]);
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

    const taskId = findStringByKeys(createJson, ["task_id", "taskId", "task"]);
    if (!taskId) {
      return fail(model, startedAt, `Wan 2.7 未返回 task_id 或视频地址：${safeJsonPreview(createJson)}`);
    }

    return pollWanTask({
      baseUrl: config.video.baseUrl,
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

export function buildWanRequestBody(
  input: WanVideoRequest,
  model: string,
  resolution: "720P" | "1080P" = "720P"
) {
  let productReferenceIndex = 0;
  const referenceGuide = input.referenceImages
    .map((image) => image.role === "scene"
      ? "首帧是当前主镜头关键帧，用于锁定场景构图、主体位置、机位和光线"
      : `图${productReferenceIndex += 1}是用户上传的真实产品图，用于锁定包装结构、颜色、材质、几何和比例；不得重绘可读包装文字或 Logo 文字`)
    .join("；");

  return {
    model,
    input: {
      prompt: appendNoReadableTextRules([
        `参考素材规则：${referenceGuide}。`,
        "产品外观必须以真实产品参考图为准，不得虚构、替换或改变产品结构。",
        "保持首帧主体构图稳定，不新增人物，不生成额外产品。真实广告标题、卖点、字幕和 CTA 全部由 Remotion 后期叠加。",
        `镜头要求：${input.prompt}`
      ].join("\n")),
      negative_prompt: [
        NO_READABLE_TEXT_NEGATIVE,
        "虚构产品，替换产品，包装结构改变，产品颜色改变，多余产品，主体变形，低清晰度"
      ].join("，"),
      media: input.referenceImages.map((image) => ({
        type: image.role === "scene" ? "first_frame" : "reference_image",
        url: image.url
      }))
    },
    parameters: {
      resolution,
      ratio: input.aspectRatio,
      duration: Math.max(3, Math.min(8, Math.round(input.durationSec))),
      prompt_extend: false,
      watermark: false
    }
  };
}

async function pollWanTask(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  taskId: string;
  requestId?: string;
  startedAt: number;
}): Promise<WanVideoResult> {
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

    const status = (findStringByKeys(json, ["task_status", "taskStatus", "status"]) ?? "").toUpperCase();
    const videoUrl = extractVideoUrl(json);
    if (videoUrl && ["SUCCEEDED", "SUCCESS", "COMPLETED", "FINISHED"].includes(status)) {
      return {
        success: true,
        provider: "dashscope",
        model: input.model,
        taskId: input.taskId,
        requestId: findStringByKeys(json, ["request_id", "requestId"]) ?? input.requestId,
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
    "Wan 2.7 视频任务轮询超过 5 分钟。任务可能仍在百炼处理中，请稍后重试或在百炼控制台查看任务状态。",
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

function extractVideoUrl(value: unknown) {
  return findStringsByKeys(value, ["video_url", "videoUrl", "url", "file_url", "output_url", "resource_url"])
    .find((item) => /^https?:\/\//i.test(item) && (/\.(mp4|mov|webm)(\?|$)/i.test(item) || /video|oss|aliyun|dashscope/i.test(item)));
}

function extractApiError(value: unknown, status: number) {
  const code = findStringByKeys(value, ["code", "error_code", "Code"]);
  const message = findStringByKeys(value, ["message", "error_message", "Message"]) ?? safeJsonPreview(value);
  return sanitizeVideoError(`DashScope Wan 2.7 HTTP ${status}${code ? ` ${code}` : ""}: ${message}`);
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
): WanVideoResult {
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
