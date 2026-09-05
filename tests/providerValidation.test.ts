import { afterEach, describe, expect, it, vi } from "vitest";

import { validateProviderConnection } from "../lib/secrets/providerValidation";

describe("provider connection validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates DeepSeek without starting a generation request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await validateProviderConnection({
      provider: "deepseek",
      apiKey: "sk-deepseek-secret",
      baseUrl: "https://api.deepseek.com"
    });

    expect(result).toMatchObject({ valid: true, usable: true, code: "VALID" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("validates a DashScope key through the non-billing model list endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await validateProviderConnection({
      provider: "qwen-image",
      apiKey: "sk-dashscope-secret",
      baseUrl: "https://dashscope.aliyuncs.com/"
    });

    expect(result).toMatchObject({ valid: true, usable: true, code: "VALID" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/api/v1/models",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("reports rejected credentials precisely without exposing the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: "invalid_api_key" } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await validateProviderConnection({
      provider: "deepseek",
      apiKey: "sk-never-return-this",
      baseUrl: "https://api.deepseek.com"
    });

    expect(result).toMatchObject({
      valid: false,
      usable: false,
      conclusive: true,
      code: "INVALID_CREDENTIALS",
      httpStatus: 401
    });
    expect(result.message).not.toContain("sk-never-return-this");
  });

  it("distinguishes a recognized key with exhausted DashScope quota", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "AllocationQuota.FreeTierOnly" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await validateProviderConnection({
      provider: "qwen-image",
      apiKey: "sk-dashscope-secret",
      baseUrl: "https://dashscope.aliyuncs.com"
    });

    expect(result).toMatchObject({
      valid: true,
      usable: false,
      conclusive: true,
      code: "QUOTA_RESTRICTED"
    });
    expect(result.message).toContain("额度或调用频率受限");
  });

  it("does not conclude that a saved key is invalid when the server cannot connect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const result = await validateProviderConnection({
      provider: "qwen-image",
      apiKey: "sk-dashscope-secret",
      baseUrl: "https://dashscope.aliyuncs.com"
    });

    expect(result).toMatchObject({
      valid: false,
      usable: false,
      conclusive: false,
      code: "NETWORK_UNREACHABLE"
    });
    expect(result.message).toContain("密钥已经保存");
  });
});
