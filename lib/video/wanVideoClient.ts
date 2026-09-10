import { getAIConfig } from "../config/ai";
import {
  NO_READABLE_TEXT_CN,
  NO_READABLE_TEXT_EN,
  NO_READABLE_TEXT_NEGATIVE
} from "../prompts/noReadableText";
import {
  appendSingleVideoConstraint,
  SINGLE_COMPOSITION_NEGATIVE_PROMPT,
  SINGLE_VIDEO_HARD_CONSTRAINT_CN,
  SINGLE_VIDEO_HARD_CONSTRAINT_EN
} from "../prompts/singleComposition";
import { assertServerOnly } from "../server-only";
import { resolveProviderApiKey } from "../secrets/resolver";
import { sanitizeVideoError } from "./downloadVideo";
import type { WanVideoRequest, WanVideoResult, WanVideoTaskResult } from "./types";

assertServerOnly("Wan 2.7 video client");

const GENERATION_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const TASK_PATH = "/api/v1/tasks";
const PROVIDER_SUBMIT_TIMEOUT_MS = 75_000;
const PROVIDER_STATUS_TIMEOUT_MS = 20_000;

export async function submitWanVideo(input: WanVideoRequest): Promise<WanVideoResult> {
  const startedAt = Date.now();
  const config = getAIConfig({ allowSessionSecrets: true });
  const model = input.model ?? config.video.model;

  if (!config.realVideoEnabled) {
    return fail(model, startedAt, "Wan 2.7 真实调用未启用：请设置 ENABLE_REAL_VIDEO=true。");
  }
  if (!/^wan2\.7-i2v(?:-|$)/i.test(model)) {
    return fail(model, startedAt, `当前单首帧图生视频必须使用 Wan 2.7 I2V；当前配置为 ${model}。`);
  }
  if (!input.referenceImages.some((image) => image.role === "scene")) {
    return fail(model, startedAt, "Wan 2.7 I2V 调用已阻止：缺少当前镜头关键帧。");
  }
  if (input.referenceImages.length > 2 || input.referenceImages[0]?.role !== "scene" || input.referenceImages.slice(1).some((image) => image.role !== "last-frame")) {
    return fail(model, startedAt, "Wan 2.7 I2V 调用已阻止：只允许一张完整首帧，或一张首帧加一张完整尾帧；不能提交拼贴参考图。");
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
      signal: AbortSignal.timeout(PROVIDER_SUBMIT_TIMEOUT_MS),
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

    return {
      success: true,
      provider: "dashscope",
      model,
      taskId,
      requestId,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return fail(model, startedAt, wanTransportError(error, "submit", PROVIDER_SUBMIT_TIMEOUT_MS));
  }
}

// Kept as a compatibility entry point for provider callers. Generation is asynchronous:
// callers must poll getWanVideoTaskStatus() when a taskId is returned.
export const generateWanVideo = submitWanVideo;

export function buildWanRequestBody(
  input: WanVideoRequest,
  model: string,
  resolution: "720P" | "1080P" = "720P"
) {
  const firstFrame = input.referenceImages.find((image) => image.role === "scene");
  const lastFrame = input.referenceImages.find((image) => image.role === "last-frame");
  if (!firstFrame || input.referenceImages.length > 2 || input.referenceImages.slice(1).some((image) => image.role !== "last-frame")) {
    throw new Error("Wan 2.7 I2V request requires exactly one first-frame image, optionally followed by one last-frame image.");
  }

  return {
    model,
    input: {
      prompt: [
        "输入只有一张完整主镜头关键帧。将这张单帧画面自然动画化。",
        SINGLE_VIDEO_HARD_CONSTRAINT_CN,
        SINGLE_VIDEO_HARD_CONSTRAINT_EN,
        "首帧中的产品已经使用用户真实 Product Master 像素完成锁定或合成。产品几何、轮廓、容器类型、原始比例、盖体结构、标签纹理、颜色和材质必须保持完全不变。禁止 morphing、包装重设计、标签突变、拉伸、融化、复制或变形。",
        "产品仅允许极小角度变化，不得快速旋转、转到背面、被手部严重遮挡、发生快速运动模糊或复杂手指操作。",
        "保持同一人物的脸部身份、发型、服装和身体比例，保持场景结构、主要道具和主光方向连续。",
        "整段视频保持同一机位逻辑和同一时空，按秒点依次完成简单微动作并形成连续动作链；不得突然改变景别、主体或背景。",
        "不新增人物，不生成额外产品。真实广告标题、卖点、字幕和 CTA 全部由 Remotion 后期叠加。",
        NO_READABLE_TEXT_CN,
        NO_READABLE_TEXT_EN,
        "除真实 Product Master 的原始像素区域外，画面其他位置不得出现任何可读文字。",
        "本条禁字要求优先级最高：忽略镜头要求中任何生成标题、卖点、字幕、数字、标语、CTA 或背景文字的指令。",
        "原有产品标签只能作为参考图像素纹理保留，不得由模型重写；无法准确保留时让该区域自然柔化，禁止生成乱码。",
        "no added readable text outside the supplied real product label, no subtitles, no typography, no watermark, no pseudo-text, no random symbols, no distorted words; preserve original product-label pixels without retyping them",
        `镜头要求：${appendSingleVideoConstraint(input.prompt)}`
      ].join("\n"),
      negative_prompt: [
        NO_READABLE_TEXT_NEGATIVE.replace(/Logo文字|包装文字/gi, ""),
        "新增文字，背景文字，字幕，标题，CTA，水印，伪文字，乱码，随机字符，扭曲单词，重绘品牌文字",
        `虚构产品，替换产品，包装结构改变，产品颜色改变，多余产品，主体变形，低清晰度，${SINGLE_COMPOSITION_NEGATIVE_PROMPT}，切镜，跳切，蒙太奇`
      ].join("，"),
      media: [
        { type: "first_frame", url: firstFrame.url },
        ...(lastFrame ? [{ type: "last_frame", url: lastFrame.url }] : [])
      ]
    },
    parameters: {
      resolution,
      duration: Math.max(3, Math.min(8, Math.round(input.durationSec))),
      prompt_extend: false,
      watermark: false,
      seed: stableSeed(`${input.projectId}:${input.shotId}`)
    }
  };
}

function stableSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function getWanVideoTaskStatus(input: {
  taskId: string;
  sessionId?: string;
  model?: string;
}): Promise<WanVideoTaskResult> {
  const startedAt = Date.now();
  const config = getAIConfig({ allowSessionSecrets: true });
  const model = input.model ?? config.video.model;
  const apiKey = await resolveProviderApiKey("wan", input.sessionId);
  if (!apiKey) {
    return taskFail(model, startedAt, "Wan 2.7 任务查询缺少百炼 Key，请重新保存并验证 DashScope API Key。", input.taskId, false);
  }

  try {
    const response = await fetch(buildUrl(config.video.baseUrl, `${TASK_PATH}/${encodeURIComponent(input.taskId)}`), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PROVIDER_STATUS_TIMEOUT_MS),
      cache: "no-store"
    });
    const json = await readJson(response);
    if (!response.ok) {
      return taskFail(
        model,
        startedAt,
        extractApiError(json, response.status),
        input.taskId,
        response.status === 408 || response.status === 429 || response.status >= 500,
        findStringByKeys(json, ["request_id", "requestId"])
      );
    }

    const status = (findStringByKeys(json, ["task_status", "taskStatus", "status"]) ?? "").toUpperCase();
    const videoUrl = extractVideoUrl(json);
    if (["SUCCEEDED", "SUCCESS", "COMPLETED", "FINISHED"].includes(status)) {
      return {
        success: true,
        status: "completed",
        provider: "dashscope",
        model,
        taskId: input.taskId,
        requestId: findStringByKeys(json, ["request_id", "requestId"]),
        ...(videoUrl ? { remoteVideoUrl: videoUrl } : {}),
        latencyMs: Date.now() - startedAt
      };
    }
    if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(status)) {
      return taskFail(
        model,
        startedAt,
        extractApiError(json, 502),
        input.taskId,
        false,
        findStringByKeys(json, ["request_id", "requestId"])
      );
    }
    return {
      success: true,
      status: "running",
      provider: "dashscope",
      model,
      taskId: input.taskId,
      requestId: findStringByKeys(json, ["request_id", "requestId"]),
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return taskFail(
      model,
      startedAt,
      wanTransportError(error, "status", PROVIDER_STATUS_TIMEOUT_MS),
      input.taskId,
      true
    );
  }
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

function wanTransportError(error: unknown, stage: "submit" | "status", timeoutMs: number) {
  const sanitized = sanitizeVideoError(error);
  if (/timeout|aborted due to timeout|aborterror/i.test(sanitized)) {
    const code = stage === "submit" ? "WAN_SUBMIT_TIMEOUT" : "WAN_STATUS_TIMEOUT";
    const action = stage === "submit" ? "提交生成任务" : "查询任务状态";
    return `${code}：百炼 Wan 2.7 在 ${Math.round(timeoutMs / 1_000)} 秒内未完成${action}。`;
  }
  const code = stage === "submit" ? "WAN_SUBMIT_NETWORK_ERROR" : "WAN_STATUS_NETWORK_ERROR";
  return `${code}：连接百炼 Wan 2.7 时失败。${sanitized ? ` ${sanitized}` : ""}`;
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

function taskFail(
  model: string,
  startedAt: number,
  error: string,
  taskId: string,
  retryable: boolean,
  requestId?: string
): WanVideoTaskResult {
  return {
    ...fail(model, startedAt, error, taskId, requestId),
    status: "failed",
    retryable
  };
}
