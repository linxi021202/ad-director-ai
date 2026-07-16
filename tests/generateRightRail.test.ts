import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const css = readFileSync("app/workspace-v3.css", "utf8");

describe("generate right status rail", () => {
  it("removes estimated cost content from the generate page", () => {
    expect(workflow).not.toContain("预估成本");
  });
  it("removes redundant status details and centers summary cards", () => {
    expect(workflow).not.toContain("完成简报后开始生成");
    expect(workflow).not.toContain("模板版本：v2.3.1");
    expect(css).toContain("align-content:center; justify-items:center; text-align:center");
  });
  it("uses short truthful model statuses", () => {
    expect(workflow).toContain('status?.happyHorse.apiAvailable ? "真实调用"');
    expect(workflow).toContain('detail: "本地未启用"');
    expect(workflow).not.toContain('detail: "本地合成尚未启用"');
  });
  it("separates model provider and status columns", () => {
    expect(workflow).toContain("model-config-row");
    expect(workflow).toContain("model-config-provider");
    expect(workflow).toContain("model-config-status");
    expect(css).toContain("grid-template-columns:minmax(0,1fr) auto");
    expect(css).toContain("max-width:82px");
  });
  it("separates trace content and status", () => {
    expect(workflow).toContain("trace-content-v3");
    expect(workflow).toContain("trace-main-row-v3");
    expect(css).toContain("grid-template-columns:16px minmax(0,1fr)");
    expect(css).toContain("font-size:13px; line-height:1.45");
  });
  it("keeps log and settings actions in separate footers", () => {
    expect(workflow).toContain('className="trace-footer-v3"');
    expect(workflow).toContain('className="status-rail-footer"');
    expect(css).toContain(".model-trace-card .trace-footer-v3 { margin-top:auto");
    expect(css).toContain(".status-rail-footer { flex:0 0 auto; padding-top:4px");
  });
  it("protects all right-rail text from overflow without tiny type", () => {
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toContain("word-break:break-word");
    expect(css).toContain("white-space:normal");
    expect(css).not.toMatch(/status-rail[^}]*font-size:(?:[0-9]|1[01])px/);
  });
});
