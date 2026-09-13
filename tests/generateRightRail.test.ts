import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const css = readFileSync("app/workspace-v3.css", "utf8");

describe("generate right status rail", () => {
  it("uses short truthful model statuses", () => {
    expect(workflow).toContain('status?.wan.apiAvailable ? "已启用" : "未就绪"');
    expect(workflow).toContain('name: "Remotion"');
    expect(workflow).not.toContain("HappyHorse 当前未配置");
  });

  it("separates model provider and status columns", () => {
    expect(workflow).toContain("model-config-row");
    expect(workflow).toContain("model-config-provider");
    expect(workflow).toContain("model-config-status");
    expect(css).toContain("grid-template-columns:minmax(0,1fr) auto");
  });

  it("keeps technical logs and model settings inside one collapsed details area", () => {
    expect(workflow).not.toContain('className="trace-footer-v3"');
    expect(workflow).not.toContain('className="status-rail-footer"');
    expect(readFileSync("components/StageDirectorRail.tsx", "utf8")).toContain('<summary>生成详情</summary>');
  });

  it("protects right-rail text from overflow", () => {
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toContain("word-break:break-word");
    expect(css).toContain("white-space:normal");
  });
});
