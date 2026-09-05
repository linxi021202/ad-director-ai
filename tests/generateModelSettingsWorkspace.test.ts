import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const generate = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const home = readFileSync("app/page.tsx", "utf8");
const sheet = readFileSync("components/ModelSettingsSheet.tsx", "utf8");
const hook = readFileSync("components/model-settings/useModelSettingsStatus.ts", "utf8");

describe("anonymous workspace model settings", () => {
  it("reuses the same settings sheet and status hook on home and generate", () => {
    expect(home).toContain("useModelSettingsStatus");
    expect(generate).toContain("useModelSettingsStatus");
    expect(home).toContain("<ModelSettingsSheet");
    expect(generate).toContain("<ModelSettingsSheet");
  });

  it("checks DeepSeek, Qwen-Image and HappyHorse before real generation", () => {
    expect(generate).toContain("missingRequiredProvider");
    expect(generate).toContain("生成策略与分镜前需要配置 DeepSeek");
    expect(generate).toContain("生成关键帧前需要配置 Qwen-Image");
    expect(generate).toContain("调用 HappyHorse 前需要配置百炼 API Key");
    expect(sheet).toContain("initialProvider");
  });

  it("shares the DashScope key with HappyHorse and keeps Remotion local execution truthful", () => {
    expect(sheet).toContain("共享百炼 API Key");
    expect(sheet).toContain("本地执行 · 无需 API Key");
    expect(generate).toContain('title="HappyHorse 视频"');
    expect(generate).toContain('toggleSelection("happyHorse")');
    expect(generate).not.toContain('provider: "happyhorse" as const');
  });

  it("does not persist API keys in browser storage", () => {
    expect(hook).toContain("/api/model-settings/status");
    expect(sheet).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(sheet).not.toMatch(/NEXT_PUBLIC_(DEEPSEEK|DASHSCOPE|HAPPYHORSE)/);
  });
});
