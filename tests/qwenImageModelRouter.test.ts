vi.mock("server-only", () => ({}));
const secret = vi.hoisted(() => ({ value: "sk-first-key-for-tests" }));
vi.mock("../lib/secrets/resolver", () => ({ resolveProviderApiKey: vi.fn(async () => secret.value) }));
vi.mock("../lib/image/dashscopeDiagnostics", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/image/dashscopeDiagnostics")>(),
  diagnoseDashScopeConnection: vi.fn(async () => ({ requestHost: "dashscope.aliyuncs.com", requestPath: "/api/v1/models", region: "cn-beijing", dns: "ok", tls: "ok", httpStatus: 200 }))
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildQwenImageRequestBody, callQwenImage } from "../lib/image/qwenImageClient";
import { clearQwenModelAvailability, generateQwenImageAdaptive, inspectQwenImageModels, selectQwenImageModels, type QwenModelAttempt } from "../lib/image/qwenImageModelRouter";
import { classifyQwenFailure, shouldFallbackQwen } from "../lib/image/qwenImageErrors";
import type { QwenImageRequest, QwenImageResult } from "../lib/image/types";

const input: QwenImageRequest = { prompt: "单帧广告", referenceImages: ["data:image/png;base64,AA=="], projectId: "project-test", shotId: "shot-1", sessionId: "image-session-test", size: "1152*2048" };
function result(model: string, success: boolean, errorCode?: string): QwenImageResult {
  return { success, provider: "dashscope", model, latencyMs: 10, size: input.size!, cacheStatus: success ? "cached" : "not-requested",
    ...(success ? { assetId: "00000000-0000-4000-8000-000000000001", imageUrl: "https://example.com/image.png" }
      : { errorCode, providerErrorCode: errorCode, error: `${errorCode}: provider failure`, httpStatus: errorCode === "AUTH_FAILED" ? 401 : 400 }) };
}

beforeEach(() => { secret.value = "sk-first-key-for-tests"; clearQwenModelAvailability(input.sessionId!); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Qwen capability-aware routing", () => {
  it("routes a character candidate to text max", async () => {
    const request = { ...input, referenceImages: [], taskType: "character_candidate" as const };
    const call = vi.fn(async (item: QwenImageRequest) => result(item.model!, true));
    const response = await generateQwenImageAdaptive(request, undefined, call);
    expect(response.model).toBe("qwen-image-max-2025-12-30");
    expect(call.mock.calls[0]?.[0]).toMatchObject({ taskType: "character_candidate", size: "928*1664" });
  });

  it("falls back from text max free tier exhaustion to the dated 2.0 pro snapshot", async () => {
    const request = { ...input, referenceImages: [], taskType: "character_candidate" as const };
    const call = vi.fn(async (item: QwenImageRequest) => item.model === "qwen-image-max-2025-12-30"
      ? result(item.model, false, "QUOTA_EXHAUSTED") : result(item.model!, true));
    const response = await generateQwenImageAdaptive(request, undefined, call);
    expect(response.model).toBe("qwen-image-2.0-pro-2026-06-22");
    expect(call.mock.calls.map(([item]) => item.model)).toEqual(["qwen-image-max-2025-12-30", "qwen-image-2.0-pro-2026-06-22"]);
  });

  it("stops the provider on Arrearage", async () => {
    const call = vi.fn(async (item: QwenImageRequest) => result(item.model!, false, "INSUFFICIENT_BALANCE"));
    expect((await generateQwenImageAdaptive({ ...input, referenceImages: [], taskType: "character_candidate" }, undefined, call)).errorCode).toBe("INSUFFICIENT_BALANCE");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("selects separate scene pools and rejects missing product references", () => {
    expect(selectQwenImageModels({ prompt: "空场", taskType: "scene_candidate_text_only" })[0]).toBe("qwen-image-max-2025-12-30");
    expect(selectQwenImageModels({ prompt: "商品在桌上", taskType: "scene_candidate_with_product_reference", referenceImage: "data:image/png;base64,AA==" })[0]).toBe("qwen-image-edit-max-2026-01-16");
    expect(() => selectQwenImageModels({ prompt: "商品在桌上", taskType: "scene_candidate_with_product_reference" })).toThrow("REFERENCE_IMAGE_REQUIRED");
    expect(selectQwenImageModels({ ...input, taskType: "keyframe_regeneration" })[0]).toBe("qwen-image-edit-max-2026-01-16");
  });

  it("does not change model on an invalid reference image", async () => {
    const call = vi.fn(async (item: QwenImageRequest) => result(item.model!, false, "INVALID_IMAGE"));
    expect((await generateQwenImageAdaptive(input, undefined, call)).errorCode).toBe("INVALID_IMAGE");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("falls back only for explicit model-scoped temporary failures", async () => {
    const call = vi.fn(async (item: QwenImageRequest) => item.model === "qwen-image-edit-max-2026-01-16"
      ? result(item.model, false, "MODEL_TEMPORARILY_UNAVAILABLE") : result(item.model!, true));
    expect((await generateQwenImageAdaptive(input, undefined, call)).model).toBe("qwen-image-2.0-pro-2026-06-22");
    expect(call).toHaveBeenCalledTimes(2);
    expect(classifyQwenFailure(503, "ServiceUnavailable", "provider unavailable")).toBe("TEMPORARY_PROVIDER_ERROR");
    expect(shouldFallbackQwen("TEMPORARY_PROVIDER_ERROR")).toBe(false);
  });

  it("retries rate limits on the same model before any fallback", async () => {
    vi.useFakeTimers();
    try {
      const call = vi.fn(async (item: QwenImageRequest) => call.mock.calls.length === 1
        ? { ...result(item.model!, false, "RATE_LIMITED"), retryAfterMs: 1 } : result(item.model!, true));
      const pending = generateQwenImageAdaptive(input, undefined, call);
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await pending).model).toBe("qwen-image-edit-max-2026-01-16");
      expect(call).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("uses edit max for reference-driven keyframes", async () => {
    const calls: string[] = [];
    const attempts: QwenModelAttempt[] = [];
    const response = await generateQwenImageAdaptive(input, async (attempt) => { attempts.push(attempt); }, async (request) => {
      calls.push(request.model!); return result(request.model!, true);
    });
    expect(calls).toEqual(["qwen-image-edit-max-2026-01-16"]);
    expect(attempts[0]).toMatchObject({ taskType: "keyframe_generation", model: "qwen-image-edit-max-2026-01-16", status: "completed", referenceCount: 1 });
    expect(response.success).toBe(true);
  });

  it("falls back on quota exhaustion and preserves the winning model and asset", async () => {
    const attempts: QwenModelAttempt[] = [];
    const call = vi.fn(async (request: QwenImageRequest) => request.model === "qwen-image-edit-max-2026-01-16" ? result(request.model, false, "QUOTA_EXHAUSTED") : result(request.model!, true));
    const first = await generateQwenImageAdaptive(input, async (attempt) => { attempts.push(attempt); }, call);
    expect(first).toMatchObject({ success: true, model: "qwen-image-2.0-pro-2026-06-22", assetId: "00000000-0000-4000-8000-000000000001" });
    expect(attempts.map((attempt) => [attempt.model, attempt.errorCode ?? attempt.status])).toEqual([
      ["qwen-image-edit-max-2026-01-16", "QUOTA_EXHAUSTED"], ["qwen-image-2.0-pro-2026-06-22", "completed"]
    ]);
    await generateQwenImageAdaptive(input, async (attempt) => { attempts.push(attempt); }, call);
    expect(call.mock.calls.filter(([request]) => request.model === "qwen-image-edit-max-2026-01-16")).toHaveLength(1);
    expect(attempts.some((attempt) => attempt.model === "qwen-image-edit-max-2026-01-16" && attempt.errorCode === "MODEL_SKIPPED_COOLDOWN")).toBe(true);
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
    expect(attempts).toHaveLength(4);
    expect(attempts.filter((attempt) => attempt.status === "failed")).toHaveLength(4);
  });

  it("rechecks a previously cooled-down model after the session key changes", async () => {
    const call = vi.fn(async (request: QwenImageRequest) => request.model === "qwen-image-edit-max-2026-01-16" ? result(request.model, false, "QUOTA_EXHAUSTED") : result(request.model!, true));
    await generateQwenImageAdaptive(input, undefined, call);
    secret.value = "sk-second-key-for-tests";
    await generateQwenImageAdaptive(input, undefined, call);
    expect(call.mock.calls.filter(([request]) => request.model === "qwen-image-edit-max-2026-01-16")).toHaveLength(2);
  });

  it("clears model-specific availability when credentials are updated", async () => {
    const call = vi.fn(async (request: QwenImageRequest) => request.model === "qwen-image-edit-max-2026-01-16"
      ? result(request.model, false, "QUOTA_EXHAUSTED") : result(request.model!, true));
    await generateQwenImageAdaptive(input, undefined, call);
    clearQwenModelAvailability(input.sessionId!);
    await generateQwenImageAdaptive(input, undefined, call);
    expect(call.mock.calls.filter(([request]) => request.model === "qwen-image-edit-max-2026-01-16")).toHaveLength(2);
  });

  it("queues concurrent calls and does not repeat an exhausted model", async () => {
    const call = vi.fn(async (request: QwenImageRequest) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return request.model === "qwen-image-edit-max-2026-01-16"
        ? result(request.model, false, "QUOTA_EXHAUSTED") : result(request.model!, true);
    });
    const [first, second] = await Promise.all([
      generateQwenImageAdaptive(input, undefined, call), generateQwenImageAdaptive(input, undefined, call)
    ]);
    expect(first.model).toBe("qwen-image-2.0-pro-2026-06-22");
    expect(second.model).toBe("qwen-image-2.0-pro-2026-06-22");
    expect(call.mock.calls.filter(([request]) => request.model === "qwen-image-edit-max-2026-01-16")).toHaveLength(1);
  });

  it("classifies provider errors without treating allocation throttling as exhausted credit", () => {
    expect(classifyQwenFailure(429, "Throttling.AllocationQuota", "Rate limit exceeded")).toBe("RATE_LIMITED");
    expect(classifyQwenFailure(400, "QuotaExceeded", "Free quota exhausted")).toBe("QUOTA_EXHAUSTED");
    expect(classifyQwenFailure(400, "AllocationQuota.FreeTierOnly", "free tier only")).toBe("QUOTA_EXHAUSTED");
    expect(classifyQwenFailure(400, "Arrearage", "Insufficient balance")).toBe("INSUFFICIENT_BALANCE");
    expect(classifyQwenFailure(400, "InvalidParameter", "Invalid image size")).toBe("INVALID_PARAMETER");
    expect(shouldFallbackQwen("AUTH_FAILED")).toBe(false);
    expect(shouldFallbackQwen("INVALID_PARAMETER")).toBe(false);
    expect(shouldFallbackQwen("INSUFFICIENT_BALANCE")).toBe(false);
    expect(shouldFallbackQwen("RATE_LIMITED")).toBe(false);
  });

  it("detects model-list visibility without submitting a paid generation request", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ output: { total: 2, models: [{ model: "qwen-image-max-2025-12-30" }, { model: "qwen-image-edit-max-2026-01-16" }] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const detection = await inspectQwenImageModels(input.sessionId!);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/v1\/models\?page_no=1&page_size=100$/);
      expect(detection.models.find((model) => model.modelId === "qwen-image-edit-max-2026-01-16")?.status).toBe("available");
      expect(detection.models.find((model) => model.modelId === "qwen-image-2.0-pro-2026-06-22")?.status).toBe("unknown");
      expect(detection.notice).toContain("不代表仍有生成额度");
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("Qwen task lifecycle", () => {
  beforeEach(() => { vi.stubEnv("AI_MODE", "real"); vi.stubEnv("ENABLE_REAL_IMAGE", "true"); });

  it("omits unsupported size and extension fields for basic qwen-image-edit", () => {
    const body = buildQwenImageRequestBody(input, "qwen-image-edit", "1152*2048", { promptExtend: true, watermark: false });
    expect(body.parameters).not.toHaveProperty("size");
    expect(body.parameters).not.toHaveProperty("prompt_extend");
    expect(body.parameters).not.toHaveProperty("watermark");
  });

  it("submits the new max snapshot to the synchronous multimodal endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/services/aigc/multimodal-generation/generation");
      expect(new Headers(init?.headers).has("X-DashScope-Async")).toBe(false);
      expect(JSON.parse(String(init?.body)).model).toBe("qwen-image-max-2025-12-30");
      return new Response(JSON.stringify({ output: { results: [{ image_url: "https://example.com/max.png" }] } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await callQwenImage({ prompt: "人物", model: "qwen-image-max-2025-12-30", sessionId: input.sessionId });
    expect(response).toMatchObject({ success: true, model: "qwen-image-max-2025-12-30" });
  });

  it("submits 3.0 asynchronously, then observes PENDING, RUNNING and SUCCEEDED", async () => {
    const statuses: string[] = [];
    let polls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/image-generation/generation")) {
        expect(new Headers(init?.headers).get("X-DashScope-Async")).toBe("enable");
        return new Response(JSON.stringify({ request_id: "submit-1", output: { task_id: "task-1", task_status: "PENDING" } }));
      }
      polls += 1;
      return new Response(JSON.stringify({ request_id: `poll-${polls}`, output: polls === 1 ? { task_status: "PENDING" } : polls === 2 ? { task_status: "RUNNING" } : { task_status: "SUCCEEDED", results: [{ image_url: "https://example.com/generated.png" }] } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await callQwenImage({ prompt: "单帧广告", model: "qwen-image-3.0", sessionId: input.sessionId,
      onTaskProgress: async (progress) => { statuses.push(progress.status); expect(progress.taskId).toBe("task-1"); } });
    expect(response).toMatchObject({ success: true, model: "qwen-image-3.0", taskId: "task-1", imageUrl: "https://example.com/generated.png" });
    expect(statuses).toEqual(["PENDING", "PENDING", "RUNNING", "SUCCEEDED"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 15_000);

  it("resumes an existing task without another paid submission", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/api/v1/tasks/existing-task");
      return new Response(JSON.stringify({ request_id: "poll-resume", output: { task_status: "SUCCEEDED", results: [{ image_url: "https://example.com/resumed.png" }] } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await callQwenImage({ prompt: "单帧广告", model: "qwen-image-3.0", sessionId: input.sessionId, resumeTaskId: "existing-task" });
    expect(response).toMatchObject({ success: true, taskId: "existing-task", imageUrl: "https://example.com/resumed.png" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when submission state is unknown", async () => {
    const call = vi.fn(async (request: QwenImageRequest) => result(request.model!, false, "SUBMISSION_STATE_UNKNOWN"));
    await generateQwenImageAdaptive(input, undefined, call);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("records safe submission metadata and the underlying network phase without another paid request", async () => {
    vi.stubEnv("DASHSCOPE_SUBMISSION_TIMEOUT_MS", "45000");
    const attempts: QwenModelAttempt[] = [];
    const fetchMock = vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT", errno: -110, syscall: "connect" })
    }); });
    vi.stubGlobal("fetch", fetchMock);
    const response = await generateQwenImageAdaptive(input, async (attempt) => { attempts.push(attempt); });
    expect(response).toMatchObject({ errorCode: "SUBMISSION_STATE_UNKNOWN", networkFailure: {
      failurePhase: "CONNECT", errorName: "TypeError", causeCode: "UND_ERR_CONNECT_TIMEOUT", causeErrno: -110, causeSyscall: "connect"
    } });
    expect(response.submissionDiagnostic).toMatchObject({ requestHost: "dashscope.aliyuncs.com",
      requestPath: "/api/v1/services/aigc/multimodal-generation/generation", region: "cn-beijing",
      apiMode: "dashscope-sync", timeoutMs: 600000, timeoutSource: "application-provider-timeout", referenceTypes: ["data-url"] });
    expect(response.submissionDiagnostic?.payloadBytes).toBeGreaterThan(100);
    expect(attempts.some((attempt) => attempt.status === "running" && attempt.submissionDiagnostic?.payloadBytes)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response)).not.toContain(secret.value);
  });

  it("keeps a submitted task on polling interruption without starting 2.0", async () => {
    const call = vi.fn(async (request: QwenImageRequest) => ({ ...result(request.model!, false, "TASK_POLL_INTERRUPTED"), taskId: "task-still-running" }));
    const response = await generateQwenImageAdaptive(input, undefined, call);
    expect(response).toMatchObject({ errorCode: "TASK_POLL_INTERRUPTED", taskId: "task-still-running" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not abort synchronous 2.0 at the old 90-second threshold", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ output: { results: [{ image_url: "https://example.com/sync.png" }] } }))));
    const response = await callQwenImage({ prompt: "单帧广告", model: "qwen-image-2.0", sessionId: input.sessionId });
    expect(response.success).toBe(true);
    expect(timeoutSpy).toHaveBeenCalledWith(300_000);
  });

  it("waits beyond six simulated minutes for edit-max and keeps the successful response", async () => {
    vi.useFakeTimers();
    try {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
        return controller.signal;
      });
      const fetchMock = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350_000));
        return new Response(JSON.stringify({ output: { results: [{ image_url: "https://example.com/late-success.png" }] } }));
      });
      vi.stubGlobal("fetch", fetchMock);
      const pending = callQwenImage({ prompt: "单帧广告", model: "qwen-image-edit-max-2026-01-16", sessionId: input.sessionId });
      for (let index = 0; index < 20 && !fetchMock.mock.calls.length; index += 1) await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(350_000);
      expect(await pending).toMatchObject({ success: true, imageUrl: "https://example.com/late-success.png", providerOutcome: "succeeded" });
      expect(timeoutSpy).toHaveBeenCalledWith(600_000);
    } finally { vi.useRealTimers(); }
  });

  it("marks synchronous response timeout as unknown without trying a second model", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
        return controller.signal;
      });
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason), { once: true });
      }));
      vi.stubGlobal("fetch", fetchMock);
      const pending = generateQwenImageAdaptive({ prompt: "单帧广告", referenceImages: ["data:image/png;base64,AA=="], sessionId: input.sessionId });
      for (let index = 0; index < 30 && !fetchMock.mock.calls.length; index += 1) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(await pending).toMatchObject({ errorCode: "PROVIDER_RESPONSE_TIMEOUT", providerOutcome: "unknown", timeoutSource: "application-provider-timeout" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
