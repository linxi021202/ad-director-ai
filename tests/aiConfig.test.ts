import { afterEach, describe, expect, it, vi } from "vitest";
import { getAIConfig, getPublicAIStatus } from "../lib/config/ai";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI environment config", () => {
  it("uses mock mode defaults without requiring API keys", () => {
    vi.stubEnv("AI_MODE", "mock");
    vi.stubEnv("ENABLE_REAL_TEXT", "false");
    vi.stubEnv("ENABLE_REAL_IMAGE", "false");

    const config = getAIConfig();
    const status = getPublicAIStatus();

    expect(config.mode).toBe("mock");
    expect(config.realTextEnabled).toBe(false);
    expect(config.realImageEnabled).toBe(false);
    expect(status.configured).toBe(true);
  });

  it("requires DeepSeek key only when real text mode is enabled", () => {
    vi.stubEnv("AI_MODE", "real");
    vi.stubEnv("ENABLE_REAL_TEXT", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    expect(() => getAIConfig()).toThrow("DEEPSEEK_API_KEY");
    expect(getPublicAIStatus().configured).toBe(false);
  });

  it("requires DashScope key when real image generation is enabled", () => {
    vi.stubEnv("AI_MODE", "real");
    vi.stubEnv("ENABLE_REAL_TEXT", "false");
    vi.stubEnv("ENABLE_REAL_IMAGE", "true");
    vi.stubEnv("DASHSCOPE_API_KEY", "");

    expect(() => getAIConfig()).toThrow("DASHSCOPE_API_KEY");
    expect(getPublicAIStatus().configured).toBe(false);
    expect(getPublicAIStatus().imageConfigured).toBe(false);
  });

  it("parses Qwen-Image defaults and boolean options", () => {
    vi.stubEnv("ENABLE_REAL_IMAGE", "true");
    vi.stubEnv("DASHSCOPE_API_KEY", "dashscope-secret");
    vi.stubEnv("QWEN_IMAGE_PROMPT_EXTEND", "true");
    vi.stubEnv("QWEN_IMAGE_WATERMARK", "false");

    const config = getAIConfig();
    const status = getPublicAIStatus();

    expect(config.qwenImage.imageModel).toBe("qwen-image");
    expect(config.qwenImage.size).toBe("1152*2048");
    expect(config.qwenImage.promptExtend).toBe(true);
    expect(config.qwenImage.watermark).toBe(false);
    expect(status.imageConfigured).toBe(true);
    expect(status.imageProvider).toBe("dashscope");
  });

  it("does not require video provider keys in phase 3", () => {
    vi.stubEnv("AI_MODE", "real");
    vi.stubEnv("ENABLE_REAL_TEXT", "false");
    vi.stubEnv("ENABLE_REAL_IMAGE", "false");
    vi.stubEnv("ENABLE_REAL_VIDEO", "true");
    vi.stubEnv("VIDEO_PROVIDER", "happyhorse");

    const config = getAIConfig();

    expect(config.realVideoEnabled).toBe(true);
    expect(config.video.provider).toBe("happyhorse");
  });

  it("normalizes legacy video provider values to HappyHorse", () => {
    vi.stubEnv("VIDEO_PROVIDER", "manual-pippit");

    const config = getAIConfig();
    const status = getPublicAIStatus();

    expect(config.video.provider).toBe("happyhorse");
    expect(status.videoProvider).toBe("happyhorse");
  });

  it("uses DashScope credentials for HappyHorse by default", () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "dashscope-secret");
    vi.stubEnv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com");
    vi.stubEnv("HAPPYHORSE_API_KEY", "");
    vi.stubEnv("HAPPYHORSE_BASE_URL", "");

    const config = getAIConfig();

    expect(config.video.happyHorseApiKey).toBe("dashscope-secret");
    expect(config.video.happyHorseBaseUrl).toBe("https://dashscope.aliyuncs.com");
  });
  it("does not expose API key values in public status", () => {
    vi.stubEnv("AI_MODE", "real");
    vi.stubEnv("ENABLE_REAL_TEXT", "true");
    vi.stubEnv("ENABLE_REAL_IMAGE", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test-secret-value");
    vi.stubEnv("DASHSCOPE_API_KEY", "dashscope-test-secret-value");

    const statusText = JSON.stringify(getPublicAIStatus());

    expect(statusText).not.toContain("sk-test-secret-value");
    expect(statusText).not.toContain("dashscope-test-secret-value");
    expect(statusText).not.toContain("apiKey");
    expect(getPublicAIStatus().configured).toBe(true);
  });
});






