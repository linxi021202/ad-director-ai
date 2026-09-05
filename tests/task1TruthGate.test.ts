vi.mock("server-only", () => ({}));
vi.mock("@/lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({
    initialized: true,
    session: { id: "truth-session", expiresAt: Date.now() + 60_000 }
  }))
}));

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST as validateProviderPOST } from "../app/api/model-settings/[provider]/validate/route";
import { GET as modelStatusGET } from "../app/api/model-settings/status/route";
import { redactProviderError, sanitizeProviderError } from "../lib/api/provider-error";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { deepseekProvider } from "../lib/providers/deepseekProvider";
import { getWanVideoCapability } from "../lib/providers/wanVideoCapability";
import { resolveProviderApiKey, resolveSessionProviderSecret } from "../lib/secrets/resolver";
import { secretStore } from "../lib/secrets/store";

const originalEnv = { ...process.env };

function strategyResponse() {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(coldBrewDemo.strategy) } }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("anonymous truth and capability gate", () => {
  afterEach(async () => {
    process.env = { ...originalEnv };
    await secretStore.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses a DeepSeek session secret without an environment key", async () => {
    process.env.DEEPSEEK_API_KEY = "";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    await secretStore.set("deepseek-session", "deepseek", "session-secret-value");
    const fetchMock = vi.fn().mockResolvedValue(strategyResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStrategy(coldBrewDemo.brief, {
      sessionId: "deepseek-session"
    });

    expect(result.success).toBe(true);
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer session-secret-value");
  });

  it("uses an environment secret only when local platform keys are explicitly allowed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_PLATFORM_KEYS", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "environment-secret-value");

    expect(await resolveSessionProviderSecret({
      sessionId: "empty-session",
      provider: "deepseek"
    })).toMatchObject({
      value: "environment-secret-value",
      source: "env",
      lastFour: "alue"
    });
  });

  it("returns a clear provider-not-configured result", async () => {
    process.env.ALLOW_PLATFORM_KEYS = "false";
    process.env.DEEPSEEK_API_KEY = "";

    expect(await resolveSessionProviderSecret({
      sessionId: "missing-session",
      provider: "deepseek"
    })).toMatchObject({
      value: null,
      source: "none",
      code: "PROVIDER_NOT_CONFIGURED",
      message: "请先配置 DeepSeek API Key。"
    });
  });

  it("never accepts HappyHorse as a configurable key provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await validateProviderPOST(
      new NextRequest("http://localhost/api/model-settings/happyhorse/validate", {
        method: "POST"
      }),
      { params: Promise.resolve({ provider: "happyhorse" }) }
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses the session DashScope key for Wan without adding another configurable provider", async () => {
    await secretStore.set("truth-session", "qwen-image", "shared-dashscope-session-key");
    expect(await resolveProviderApiKey("wan", "truth-session")).toBe("shared-dashscope-session-key");
    expect(getWanVideoCapability(true, true)).toMatchObject({
      capability: "api-available",
      apiAvailable: true,
      manualImportAvailable: true
    });
  });

  it("publishes only minimal anonymous model status fields", async () => {
    process.env.ENABLE_REAL_VIDEO = "false";
    await secretStore.set("truth-session", "deepseek", "session-secret-last-1234");
    const response = await modelStatusGET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(body.deepseek).toMatchObject({
      configured: true,
      source: "session",
      lastFour: "1234"
    });
    expect(body.qwenImage).toEqual({ configured: false, source: "none" });
    expect(body.wan).toEqual({
      capability: "not-configured",
      apiAvailable: false
    });
    expect(body.remotion).toEqual({ source: "local" });
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("updatedAt");
  });

  it("publishes Wan availability when real video and the shared DashScope key are ready", async () => {
    process.env.ENABLE_REAL_VIDEO = "true";
    await secretStore.set("truth-session", "qwen-image", "shared-dashscope-session-key");
    const response = await modelStatusGET();
    const body = await response.json();

    expect(body.wan).toEqual({ capability: "api-available", apiAvailable: true });
  });

  it("redacts tokens and returns provider-safe public messages", () => {
    const unsafe = "Authorization: Bearer secret-token-value apiKey=super-secret-value?key=query-secret";
    const redacted = redactProviderError(unsafe);
    expect(redacted).not.toContain("secret-token-value");
    expect(redacted).not.toContain("super-secret-value");
    const publicMessage = sanitizeProviderError(unsafe, "happyhorse");
    expect(publicMessage).toContain("HappyHorse");
    expect(publicMessage).not.toContain("secret-token-value");
  });
});
