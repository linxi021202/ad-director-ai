vi.mock("server-only", () => ({}));
const secret = vi.hoisted(() => ({ value: "sk-first-key-for-tests" }));
vi.mock("../lib/secrets/resolver", () => ({ resolveProviderApiKey: vi.fn(async () => secret.value) }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearQwenModelAvailability, generateQwenImageAdaptive, inspectQwenImageModels, type QwenModelAttempt } from "../lib/image/qwenImageModelRouter";
import { classifyQwenFailure, shouldFallbackQwen } from "../lib/image/qwenImageErrors";
import type { QwenImageRequest, QwenImageResult } from "../lib/image/types";

const input: QwenImageRequest = { prompt: "单帧广告", referenceImages: ["data:image/png;base64,AA=="], projectId: "project-test", shotId: "shot-1", sessionId: "image-session-test", size: "1152*2048" };
function result(model: string, success: boolean, errorCode?: string): QwenImageResult {
  return { success, provider: "dashscope", model, latencyMs: 10, size: input.size!, cacheStatus: success ? "cached" : "not-requested",
    ...(success ? { assetId: "00000000-0000-4000-8000-000000000001", imageUrl: "https://example.com/image.png" }
      : { errorCode, providerErrorCode: errorCode, error: `${errorCode}: provider failure`, httpStatus: errorCode === "AUTH_FAILED" ? 401 : 400 }) };
}

beforeEach(() => { secret.value = "sk-first-key-for-tests"; clearQwenModelAvailability(input.sessionId!); });

describe("Qwen capability-aware routing", () => {
  it("skips legacy qwen-image without making a reference-image request", async () => {
    const calls: string[] = [];
    const attempts: QwenModelAttempt[] = [];
    const response = await generateQwenImageAdaptive(input, async (attempt) => { attempts.push(attempt); }, async (request) => {
      calls.push(request.model!); return result(request.model!, true);
    });
    expect(calls).toEqual(["qwen-image-3.0"]);
    expect(attempts[0]).toMatchObject({ model: "qwen-image", status: "blocked", errorCode: "MODEL_SKIPPED_CAPABILITY_MISMATCH", referenceCount: 1 });
    expect(response.success).toBe(true);
  });

  it("falls back on quota exhaustion and preserves the winning model and asset", async () => {
    const attempts: QwenModelAttempt[] = [];
    const call = vi.fn(async (request: QwenImageRequest) => request.model === "qwen-image-3.0" ? result(request.model, false, "QUOTA_EXHAUSTED") : result(request.model!, true));
    const first = await generateQwenImageAdaptive(input, async (attempt) => { attempts.push(attempt); }, call);
    expect(first).toMatchObject({ success: true, model: "qwen-image-2.0", assetId: "00000000-0000-4000-8000-000000000001" });
    expect(attempts.map((attempt) => [attempt.model, attempt.errorCode ?? attempt.status])).toEqual([
      ["qwen-image", "MODEL_SKIPPED_CAPABILITY_MISMATCH"], ["qwen-image-3.0", "QUOTA_EXHAUSTED"], ["qwen-image-2.0", "completed"]
    ]);
    await generateQwenImageAdaptive(input, async (attempt) => { attempts.push(attempt); }, call);
    expect(call.mock.calls.filter(([request]) => request.model === "qwen-image-3.0")).toHaveLength(1);
    expect(attempts.some((attempt) => attempt.model === "qwen-image-3.0" && attempt.errorCode === "MODEL_SKIPPED_COOLDOWN")).toBe(true);
  });

  it("stops on malformed parameters instead of repeating the request on another model", async () => {
    const call = vi.fn(async (request: QwenImageRequest) => result(request.model!, false, "INVALID_PARAMETER"));
    const response = await generateQwenImageAdaptive(input, undefined, call);
    expect(response.errorCode).toBe("INVALID_PARAMETER");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("stops on a shared-key authentication failure", async () => {
    const call = vi.fn(async (request: QwenImageRequest) => result(request.model!, false, "AUTH_FAILED"));
    await generateQwenImageAdaptive(input, undefined, call);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("returns a real failure when every reference-capable candidate is unavailable", async () => {
    const attempts: QwenModelAttempt[] = [];
    const response = await generateQwenImageAdaptive(input, async (attempt) => { attempts.push(attempt); }, async (request) => result(request.model!, false, "MODEL_NOT_AVAILABLE"));
    expect(response.success).toBe(false);
    expect(attempts).toHaveLength(3);
    expect(attempts.filter((attempt) => attempt.status === "failed")).toHaveLength(2);
  });

  it("rechecks a previously cooled-down model after the session key changes", async () => {
    const call = vi.fn(async (request: QwenImageRequest) => request.model === "qwen-image-3.0" ? result(request.model, false, "QUOTA_EXHAUSTED") : result(request.model!, true));
    await generateQwenImageAdaptive(input, undefined, call);
    secret.value = "sk-second-key-for-tests";
    await generateQwenImageAdaptive(input, undefined, call);
    expect(call.mock.calls.filter(([request]) => request.model === "qwen-image-3.0")).toHaveLength(2);
  });

  it("classifies provider errors without treating allocation throttling as exhausted credit", () => {
    expect(classifyQwenFailure(429, "Throttling.AllocationQuota", "Rate limit exceeded")).toBe("RATE_LIMITED");
    expect(classifyQwenFailure(400, "QuotaExceeded", "Free quota exhausted")).toBe("QUOTA_EXHAUSTED");
    expect(classifyQwenFailure(400, "Arrearage", "Insufficient balance")).toBe("INSUFFICIENT_BALANCE");
    expect(classifyQwenFailure(400, "InvalidParameter", "Invalid image size")).toBe("INVALID_PARAMETER");
    expect(shouldFallbackQwen("AUTH_FAILED")).toBe(false);
    expect(shouldFallbackQwen("INVALID_PARAMETER")).toBe(false);
  });

  it("detects model-list visibility without submitting a paid generation request", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ output: { total: 2, models: [{ model: "qwen-image" }, { model: "qwen-image-3.0" }] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const detection = await inspectQwenImageModels(input.sessionId!);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/v1\/models\?page_no=1&page_size=100$/);
      expect(detection.models.find((model) => model.modelId === "qwen-image-3.0")?.status).toBe("available");
      expect(detection.models.find((model) => model.modelId === "qwen-image-2.0")?.status).toBe("unknown");
      expect(detection.notice).toContain("不代表仍有生成额度");
    } finally { vi.unstubAllGlobals(); }
  });
});
