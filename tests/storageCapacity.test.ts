vi.mock("server-only", () => ({}));
vi.mock("../lib/secrets/resolver", () => ({ resolveProviderApiKey: vi.fn(async () => "sk-capacity-test-key") }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  statfs: vi.fn(), access: vi.fn(async () => undefined), mkdir: vi.fn(async () => undefined)
}));
vi.mock("../lib/render/videoFonts", () => ({ assertVideoFontsAvailable: vi.fn(async () => undefined) }));

import { statfs } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as healthGET } from "../app/api/health/route";
import { assertImageStorageCapacity, isStorageFullError, readStorageCapacity } from "../lib/assets/storageCapacity";
import { callQwenImage } from "../lib/image/qwenImageClient";
import { clearQwenModelAvailability, generateQwenImageAdaptive } from "../lib/image/qwenImageModelRouter";
import { qwenImageUserMessage, shouldFallbackQwen } from "../lib/image/qwenImageErrors";

const MB = 1024 * 1024;
function setFreeBytes(bytes: number, freeInodes = 100) {
  vi.mocked(statfs).mockResolvedValue({ bsize: 1, bavail: bytes, bfree: bytes, blocks: 512 * MB,
    files: 1000, ffree: freeInodes, type: 0 });
}
beforeEach(() => { setFreeBytes(100 * MB); vi.stubEnv("AI_MODE", "real"); vi.stubEnv("ENABLE_REAL_IMAGE", "true");
  clearQwenModelAvailability("capacity-test"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("image storage capacity", () => {
  it("detects the production-sized 1.28 MB free-space failure", async () => {
    setFreeBytes(1343488);
    expect(await readStorageCapacity()).toMatchObject({ freeBytes: 1343488, imageGenerationReady: false });
    await expect(assertImageStorageCapacity()).rejects.toMatchObject({ code: "STORAGE_CAPACITY_LOW" });
  });
  it("budgets the candidate batch without consuming the metadata reserve", async () => {
    setFreeBytes(48 * MB);
    await expect(assertImageStorageCapacity(1)).resolves.toBeDefined();
    await expect(assertImageStorageCapacity(3)).rejects.toMatchObject({ code: "STORAGE_CAPACITY_LOW" });
  });
  it("also detects inode exhaustion", async () => {
    setFreeBytes(100 * MB, 0);
    await expect(assertImageStorageCapacity()).rejects.toMatchObject({ code: "STORAGE_CAPACITY_LOW" });
  });
  it("blocks the model request before fetching or paid submission", async () => {
    setFreeBytes(1343488);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const result = await callQwenImage({ prompt: "人物", model: "qwen-image-max-2025-12-30", projectId: "test",
      shotId: "candidate-1", sessionId: "capacity-test" });
    expect(result).toMatchObject({ success: false, errorCode: "STORAGE_CAPACITY_LOW", cacheStatus: "not-requested" });
    expect(result.requestStartedAt).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("never tries another model for storage failures", async () => {
    const call = vi.fn(async (input) => ({ success: false, provider: "dashscope" as const, model: input.model!, latencyMs: 0,
      size: "928*1664", errorCode: "STORAGE_CAPACITY_LOW" }));
    await generateQwenImageAdaptive({ prompt: "人物", taskType: "character_candidate", sessionId: "capacity-test" }, undefined, call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(shouldFallbackQwen("STORAGE_CAPACITY_LOW")).toBe(false);
    expect(qwenImageUserMessage("STORAGE_CAPACITY_LOW")).toContain("存储空间不足");
  });
  it("warns in health output without making storage-management pages unreachable", async () => {
    setFreeBytes(1343488);
    const response = await healthGET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "degraded", checks: { imageGenerationReady: false, storageTotalBytes: 512 * MB } });
    expect(body.warnings[0]).toContain("存储空间不足");
  });
  it("identifies both a full filesystem and exceeded storage quota", () => {
    expect(isStorageFullError(Object.assign(new Error("write failed"), { code: "ENOSPC" }))).toBe(true);
    expect(isStorageFullError(Object.assign(new Error("quota"), { code: "EDQUOT" }))).toBe(true);
    expect(isStorageFullError(new Error("network error"))).toBe(false);
  });
});
