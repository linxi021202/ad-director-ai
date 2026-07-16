vi.mock("@/lib/auth/api", () => ({
  requireApiUser: vi.fn(async () => ({
    authenticated: true,
    user: { id: "test-user", email: "test@example.com", name: "测试用户" }
  }))
}));
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as modelStatusGET } from "../app/api/model-settings/status/route";
import { POST as validateProviderPOST } from "../app/api/model-settings/[provider]/validate/route";
import { redactProviderError, sanitizeProviderError } from "../lib/api/provider-error";
import { createHappyHorseValidationResponse } from "../lib/api/happyhorse-validation";
import { createDeepSeekClient } from "../lib/llm/deepseekClient";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { deepseekProvider } from "../lib/providers/deepseekProvider";
import { getHappyHorseCapability } from "../lib/providers/happyHorseCapability";
import { resolveProviderSecret } from "../lib/secrets/resolver";
import { secretStore } from "../lib/secrets/store";

const originalEnv = { ...process.env };

function strategyResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(coldBrewDemo.strategy) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("task 1 truth and capability gate", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses a DeepSeek session secret without an environment key", async () => {
    process.env.DEEPSEEK_API_KEY = "";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    await secretStore.set("deepseek-session", "deepseek", "session-secret-value");
    const fetchMock = vi.fn().mockResolvedValue(strategyResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStrategy(coldBrewDemo.brief, { sessionId: "deepseek-session" });

    expect(result.success).toBe(true);
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer session-secret-value");
  });

  it("uses the environment secret when the session has none", async () => {
    process.env.DEEPSEEK_API_KEY = "environment-secret-value";
    expect(await resolveProviderSecret("deepseek", "empty-session")).toMatchObject({
      value: "environment-secret-value",
      source: "env",
      lastFour: "alue"
    });
  });

  it("prefers session secrets and reports none clearly", async () => {
    process.env.DEEPSEEK_API_KEY = "environment-secret-value";
    await secretStore.set("priority-session", "deepseek", "priority-session-value");
    expect((await resolveProviderSecret("deepseek", "priority-session")).source).toBe("session");
    process.env.DEEPSEEK_API_KEY = "";
    expect(await resolveProviderSecret("deepseek", "missing-session")).toEqual({ value: null, source: "none" });
  });

  it("creates a DeepSeek client only from explicit runtime arguments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createDeepSeekClient({ apiKey: "explicit-secret-value", baseUrl: "https://example.test", model: "deepseek-v4-pro" });
    const result = await client.call({ messages: [{ role: "user", content: "hello" }], responseFormat: "text" });
    expect(result.success).toBe(true);
    expect(result.model).toBe("deepseek-v4-pro");
  });

  it("never performs a guessed HappyHorse validation request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await validateProviderPOST(
      new NextRequest("http://localhost/api/model-settings/happyhorse/validate", { method: "POST" }),
      { params: Promise.resolve({ provider: "happyhorse" }) }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ valid: true, capability: "manual-import" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks HappyHorse when manual import is unavailable", async () => {
    expect(getHappyHorseCapability(false)).toMatchObject({
      capability: "not-configured",
      apiAvailable: false,
      manualImportAvailable: false,
      status: "blocked"
    });
    expect((await createHappyHorseValidationResponse(false)).status).toBe(409);
  });

  it("publishes only minimal model status fields", async () => {
    process.env.DEEPSEEK_API_KEY = "environment-secret-value";
    const response = await modelStatusGET();
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("environment-secret-value");
    expect(body.deepseek).toMatchObject({ configured: true, source: "env", lastFour: "alue" });
    expect(body.happyHorse).toMatchObject({ capability: "manual-import", apiAvailable: false });
    expect(body.remotion).toEqual({ configured: false, source: "local", status: "not-installed" });
    expect(serialized).not.toContain("updatedAt");
  });


  it("marks HappyHorse api available only when real video and a server key exist", async () => {
    process.env.ENABLE_REAL_VIDEO = "true";
    process.env.DASHSCOPE_API_KEY = "dashscope-secret-value";
    const response = await modelStatusGET();
    const body = await response.json();
    expect(body.happyHorse).toMatchObject({ capability: "api-available", apiAvailable: true, configured: true });
    expect(JSON.stringify(body)).not.toContain("dashscope-secret-value");
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

  it("contains no browser-persisted or public model keys and no connected HappyHorse claim", () => {
    const files = [
      readFileSync("components/ModelSettingsSheet.tsx", "utf8"),
      readFileSync("components/GenerateWorkflow.tsx", "utf8"),
      readFileSync("components/ModelTracePanel.tsx", "utf8"),
      readFileSync(".env.example", "utf8")
    ].join("\n");
    expect(files).not.toMatch(/NEXT_PUBLIC_(?:DEEPSEEK|DASHSCOPE|HAPPYHORSE)/);
    expect(files).not.toMatch(/NEXT_PUBLIC_(?:DEEPSEEK|DASHSCOPE|HAPPYHORSE)/);
    expect(readFileSync("components/ModelSettingsSheet.tsx", "utf8")).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});

