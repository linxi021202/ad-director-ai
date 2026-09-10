import { z } from "zod";

import { getAIConfig } from "../config/ai";
import { assertServerOnly } from "../server-only";
import { resolveProviderApiKey } from "../secrets/resolver";

assertServerOnly("Qwen visual inspector");

const INSPECTOR_TIMEOUT_MS = 90_000;

export type VisualInspectorInput<TSchema extends z.ZodTypeAny> = {
  sessionId: string;
  prompt: string;
  schema: TSchema;
  images?: string[];
  videoUrl?: string;
};

export type VisualInspectorResult<T> = {
  success: boolean;
  data?: T;
  model: string;
  requestId?: string;
  latencyMs: number;
  error?: string;
};

export async function callVisualInspector<TSchema extends z.ZodTypeAny>(
  input: VisualInspectorInput<TSchema>
): Promise<VisualInspectorResult<z.infer<TSchema>>> {
  const startedAt = Date.now();
  const config = getAIConfig({ allowSessionSecrets: true });
  const model = config.qwenImage.inspectorModel || "qwen3.7-plus";
  const apiKey = await resolveProviderApiKey("qwen-image", input.sessionId);
  if (!apiKey) return failure(model, startedAt, "VISUAL_INSPECTOR_KEY_REQUIRED");

  const mediaContent = [
    ...(input.images ?? []).map((url) => ({ type: "image_url", image_url: { url } } as const)),
    ...(input.videoUrl ? [{ type: "video_url", video_url: { url: input.videoUrl } } as const] : [])
  ];
  if (!mediaContent.length) return failure(model, startedAt, "VISUAL_INSPECTOR_MEDIA_REQUIRED");

  try {
    const response = await fetch(buildInspectorUrl(config.qwenImage.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are a strict commercial-visual inspector. Return one valid JSON object only. Never infer unseen details and never soften a failed hard constraint."
          },
          {
            role: "user",
            content: [...mediaContent, { type: "text", text: input.prompt }]
          }
        ],
        response_format: { type: "json_object" },
        enable_thinking: false,
        temperature: 0
      }),
      signal: AbortSignal.timeout(INSPECTOR_TIMEOUT_MS),
      cache: "no-store"
    });
    const json = await readJson(response);
    if (!response.ok) return failure(model, startedAt, extractError(json, response.status));

    const content = extractMessageContent(json);
    if (!content) return failure(model, startedAt, "VISUAL_INSPECTOR_EMPTY_RESPONSE");
    const parsed = input.schema.safeParse(parseJsonObject(content));
    if (!parsed.success) {
      return failure(model, startedAt, `VISUAL_INSPECTOR_SCHEMA_ERROR: ${parsed.error.issues[0]?.message ?? "invalid JSON"}`);
    }
    return {
      success: true,
      data: parsed.data,
      model,
      requestId: findString(json, ["request_id", "requestId"]),
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown transport error";
    return failure(model, startedAt, `VISUAL_INSPECTOR_REQUEST_FAILED: ${message.slice(0, 240)}`);
  }
}

export function buildInspectorUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/$/, "");
  if (/\/compatible-mode\/v1$/i.test(path)) url.pathname = `${path}/chat/completions`;
  else if (/\/compatible-mode\/v1\/chat\/completions$/i.test(path)) url.pathname = path;
  else url.pathname = "/compatible-mode/v1/chat/completions";
  return url.toString();
}

function parseJsonObject(content: string) {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(clean) as unknown;
}

function extractMessageContent(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: unknown }).message
    : undefined;
  const content = message && typeof message === "object"
    ? (message as { content?: unknown }).content
    : undefined;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content.map((item) => item && typeof item === "object" && "text" in item ? String(item.text) : "").join("");
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as unknown; } catch { return { message: text.slice(0, 400) }; }
}

function extractError(value: unknown, status: number) {
  const detail = findString(value, ["message", "error_msg", "code"]);
  return `VISUAL_INSPECTOR_HTTP_${status}${detail ? `: ${detail.slice(0, 240)}` : ""}`;
}

function findString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key) && typeof nested === "string" && nested.trim()) return nested;
    const found = findString(nested, keys);
    if (found) return found;
  }
  return undefined;
}

function failure(model: string, startedAt: number, error: string): VisualInspectorResult<never> {
  return { success: false, model, latencyMs: Date.now() - startedAt, error };
}
