vi.mock("server-only", () => ({}));
const secret = vi.hoisted(() => ({ value: "sk-first-key-for-tests" }));
vi.mock("../lib/secrets/resolver", () => ({ resolveProviderApiKey: vi.fn(async () => secret.value) }));
vi.mock("../lib/image/dashscopeDiagnostics", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/image/dashscopeDiagnostics")>(),
  diagnoseDashScopeConnection: vi.fn(async () => ({ requestHost: "dashscope.aliyuncs.com", requestPath: "/api/v1/models", region: "cn-beijing", dns: "ok", tls: "ok", httpStatus: 200 }))
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callQwenImage } from "../lib/image/qwenImageClient";
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
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

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

describe("Qwen task lifecycle", () => {
  beforeEach(() => { vi.stubEnv("AI_MODE", "real"); vi.stubEnv("ENABLE_REAL_IMAGE", "true"); });

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
      requestPath: "/api/v1/services/aigc/image-generation/generation", region: "cn-beijing",
      apiMode: "dashscope-async", timeoutMs: 45000, referenceTypes: ["data-url"] });
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
});
