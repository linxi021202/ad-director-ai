import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getProviderSecretStatus,
  resolveProviderApiKey,
  resolveSessionProviderSecret
} from "../lib/secrets/resolver";
import { secretStore } from "../lib/secrets/store";

describe("anonymous model settings secret resolution", () => {
  afterEach(async () => {
    await secretStore.clear();
    vi.unstubAllEnvs();
  });

  it("keeps DeepSeek secrets isolated by anonymous session", async () => {
    await secretStore.set("session-a", "deepseek", "session-a-secret-value");
    await secretStore.set("session-b", "deepseek", "session-b-secret-value");

    expect(await resolveProviderApiKey("deepseek", "session-a")).toBe("session-a-secret-value");
    expect(await resolveProviderApiKey("deepseek", "session-b")).toBe("session-b-secret-value");
  });

  it("keeps Qwen-Image independent from another session", async () => {
    await secretStore.set("session-a", "qwen-image", "dashscope-secret-A1B2");
    const statusA = await getProviderSecretStatus("qwen-image", "session-a");
    const statusB = await getProviderSecretStatus("qwen-image", "session-b");

    expect(statusA).toMatchObject({ configured: true, source: "session", lastFour: "A1B2" });
    expect(statusB).toEqual({ configured: false, source: "none" });
    expect(JSON.stringify(statusA)).not.toContain("dashscope-secret");
  });

  it("does not use platform keys unless explicitly allowed in local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_PLATFORM_KEYS", "false");
    vi.stubEnv("DEEPSEEK_API_KEY", "environment-secret-value");

    expect(await resolveSessionProviderSecret({
      sessionId: "empty-session",
      provider: "deepseek"
    })).toMatchObject({ value: null, source: "none", code: "PROVIDER_NOT_CONFIGURED" });

    vi.stubEnv("ALLOW_PLATFORM_KEYS", "true");
    expect(await resolveSessionProviderSecret({
      sessionId: "empty-session",
      provider: "deepseek"
    })).toMatchObject({ value: "environment-secret-value", source: "env" });
  });

  it("never exposes platform keys in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PLATFORM_KEYS", "true");
    vi.stubEnv("DASHSCOPE_API_KEY", "production-platform-secret");

    expect(await resolveSessionProviderSecret({
      sessionId: "anonymous-session",
      provider: "qwen-image"
    })).toMatchObject({ value: null, source: "none", code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("clears only the requested session and clears all secrets on service restart", async () => {
    await secretStore.set("session-a", "deepseek", "session-a-secret-value");
    await secretStore.set("session-b", "deepseek", "session-b-secret-value");

    await secretStore.deleteSession("session-a");
    expect(await resolveProviderApiKey("deepseek", "session-a")).toBeNull();
    expect(await resolveProviderApiKey("deepseek", "session-b")).toBe("session-b-secret-value");

    await secretStore.clear();
    expect(await resolveProviderApiKey("deepseek", "session-b")).toBeNull();
  });
});