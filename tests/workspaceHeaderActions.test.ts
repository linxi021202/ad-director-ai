import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("app/cinema-system.css", "utf8");
const header = readFileSync("components/workspace/WorkspaceHeader.tsx", "utf8");
const workflow = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const logDrawer = readFileSync("components/workspace/CallLogDrawer.tsx", "utf8");

describe("workspace header actions", () => {
  it.each([1920, 1600, 1440, 1366, 1280])("keeps desktop actions unshrunk at %ipx", (width) => {
    expect(width).toBeGreaterThan(1100);
    expect(styles).toContain("grid-template-columns: max-content minmax(0, 1fr) max-content");
    expect(styles).toContain("flex: 0 0 auto !important");
    expect(styles).toContain("min-width: max-content !important");
    expect(styles).toContain("white-space: nowrap");
  });

  it("uses one header action style for logs, guide, new project and model settings", () => {
    expect(header).toContain("<CallLogDrawer");
    expect(logDrawer).toContain('className="call-log-trigger workspace-header-action"');
    expect(workflow).toContain("<HeaderActionButton onClick={openProjectEntry}>新建项目</HeaderActionButton>");
    expect(workflow).toContain("<HeaderActionButton onClick={() => { setUsageGuideIntro(false); setUsageGuideOpen(true); }}>使用说明</HeaderActionButton>");
    expect(workflow).toContain('className="workspace-model-settings-trigger workspace-header-action"');
    expect(styles).toContain("height: 40px !important");
  });

  it("moves narrow headers to a scrollable single-line action row", () => {
    expect(styles).toContain("@media (max-width: 1100px)");
    expect(styles).toContain("overflow-x: auto");
    expect(styles).toContain("flex-wrap: nowrap");
  });
});
