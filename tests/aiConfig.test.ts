import { afterEach, describe, expect, it, vi } from "vitest";
import { getAIConfig, getPublicAIStatus } from "../lib/config/ai";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI environment config for anonymous BYOK", () => {
  it("uses mock mode defaults without requiring API keys", () => {
    vi.stubEnv("AI_MODE", "mock");
    vi.stubEnv("ENABLE_REAL_TEXT", "false");
    vi.stubEnv("ENABLE_REAL_IMAGE", "false");

    const config = getAIConfig();
    expect(config.mode).toBe("mock");
    expect(getPublicAIStatus().configured).toBe(true);
  });

  it("allows real provider flags without platform keys because keys may come from the session", () => {
    vi.stubEnv("AI_MODE", "real");
    vi.stubEnv("ENABLE_REAL_TEXT", "true");
    vi.stubEnv("ENABLE_REAL_IMAGE", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("DASHSCOPE_API_KEY", "");

    const config = getAIConfig();
    expect(config.realTextEnabled).toBe(true);
    expect(config.realImageEnabled).toBe(true);
    expect(config.deepseek.configured).toBe(false);
    expect(config.qwenImage.configured).toBe(false);
  });

  it("uses platform keys only in explicitly allowed non-production development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_PLATFORM_KEYS", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "development-deepseek-secret");
    vi.stubEnv("DASHSCOPE_API_KEY", "development-dashscope-secret");

    const config = getAIConfig();
    expect(config.platformKeysAllowed).toBe(true);
    expect(config.deepseek.configured).toBe(true);
    expect(config.qwenImage.configured).toBe(true);
  });

  it("disables platform keys in production even when the flag is true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PLATFORM_KEYS", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "production-secret");

    const config = getAIConfig();
    expect(config.platformKeysAllowed).toBe(false);
    expect(config.deepseek.configured).toBe(false);
  });

  it("does not expose API key values in public status", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_PLATFORM_KEYS", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test-secret-value");
    vi.stubEnv("DASHSCOPE_API_KEY", "dashscope-test-secret-value");

    const statusText = JSON.stringify(getPublicAIStatus());
    expect(statusText).not.toContain("sk-test-secret-value");
    expect(statusText).not.toContain("dashscope-test-secret-value");
    expect(statusText).not.toContain("apiKey");
  });
});