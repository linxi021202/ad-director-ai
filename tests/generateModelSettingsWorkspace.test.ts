import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const generate = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const home = readFileSync("app/page.tsx", "utf8");
const sheet = readFileSync("components/ModelSettingsSheet.tsx", "utf8");
const hook = readFileSync("components/model-settings/useModelSettingsStatus.ts", "utf8");
const trigger = readFileSync("components/model-settings/ModelSettingsTrigger.tsx", "utf8");
const css = readFileSync("app/workspace-v3.css", "utf8");

describe("generate workspace model settings and rail layout", () => {
  it("reuses the same settings sheet and status hook on home and generate", () => {
    expect(home).toContain("useModelSettingsStatus"); expect(generate).toContain("useModelSettingsStatus");
    expect(home).toContain("<ModelSettingsSheet"); expect(generate).toContain("<ModelSettingsSheet");
    expect(generate).not.toContain("GenerateModelSettingsSheet");
  });
  it("offers settings entry points in the header and status rail", () => {
    expect(generate).toContain("workspace-model-settings-trigger"); expect(generate).toContain("ModelConfigurationCard");
    expect(generate).toContain("管理模型设置"); expect(trigger).toContain("模型设置");
  });
  it("opens the correct provider before a paid generation request", () => {
    expect(generate).toContain("missingRequiredProvider"); expect(generate).toContain("生成策略与分镜前需要配置 DeepSeek");
    expect(generate).toContain("生成关键帧前需要配置 Qwen-Image"); expect(sheet).toContain("initialProvider"); expect(sheet).toContain("model-key-");
  });
  it("refreshes status without exposing keys to browser persistence", () => {
    expect(hook).toContain('/api/model-settings/status'); expect(sheet).toContain("await refresh()");
    expect([hook, trigger, sheet].join("\n")).not.toMatch(/localStorage|sessionStorage|indexedDB|NEXT_PUBLIC_(?:DEEPSEEK|DASHSCOPE|HAPPYHORSE)/);
  });
  it("keeps HappyHorse and Remotion status truthful", () => {
    expect(generate).toContain('status?.happyHorse.apiAvailable ? "真实调用"'); expect(generate).toContain('detail: "本地未启用"');
    expect(generate).toContain("HappyHorse 主镜头调用中");
  });
  it("uses the requested compact, stretching three-column shell", () => {
    expect(css).toContain("grid-template-columns:272px minmax(0,1fr) 236px"); expect(css).toContain("min-height:calc(100svh - 130px)");
    expect(css).toContain(".brief-sidebar-shell,.status-rail-shell"); expect(css).toContain(".model-trace-card { flex:1; min-height:280px");
  });
  it("uses compact form and upload dimensions", () => {
    expect(css).toContain("height:40px; min-height:40px"); expect(css).toContain("min-height:82px; max-height:120px");
    expect(css).toContain('textarea[rows="4"] { min-height:104px; max-height:150px'); expect(css).toContain("height:112px; min-height:112px");
  });
  it("moves the status rail below at 1180 and becomes single-column on mobile", () => {
    expect(css).toContain("@media(max-width:1179px)"); expect(css).toContain("grid-column:1/-1");
    expect(css).toContain("@media(max-width:820px)"); expect(css).toContain("grid-template-columns:1fr");
  });
});
