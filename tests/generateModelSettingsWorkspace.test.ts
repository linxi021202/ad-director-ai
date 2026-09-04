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

  it("checks DeepSeek and Qwen-Image before real generation", () => {
    expect(generate).toContain("missingRequiredProvider");
    expect(generate).toContain("生成策略与分镜前需要配置 DeepSeek");
    expect(generate).toContain("生成关键帧前需要配置 Qwen-Image");
    expect(sheet).toContain("initialProvider");
  });

  it("keeps HappyHorse manual import and Remotion local execution truthful", () => {
    expect(sheet).toContain("手动导入模式 · 无需 API Key");
    expect(sheet).toContain("本地执行 · 无需 API Key");
    expect(generate).toContain('detail: "手动导入"');
    expect(generate).not.toContain('provider: "happyhorse" as const');
  });

  it("does not persist API keys in browser storage", () => {
    expect(hook).toContain("/api/model-settings/status");
    expect(sheet).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(sheet).not.toMatch(/NEXT_PUBLIC_(DEEPSEEK|DASHSCOPE|HAPPYHORSE)/);
  });
});