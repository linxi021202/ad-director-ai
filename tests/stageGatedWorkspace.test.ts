import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const rail = readFileSync("components/StageDirectorRail.tsx", "utf8");
const gates = readFileSync("lib/workflow/stageGates.ts", "utf8");
const css = readFileSync("app/workspace-v3.css", "utf8");

describe("stage-gated director workspace", () => {
  it("exposes all seven stages and restores selection from the URL", () => {
    for (const label of ["广告需求", "创意方向", "视觉基准", "文字分镜", "关键帧", "视频与配音", "最终成片"]) {
      expect(`${rail}\n${gates}`).toContain(label);
    }
    expect(workflow).toContain('useSearchParams()');
    expect(workflow).toContain('searchParams.get("stage")');
    expect(workflow).toContain('`/generate?projectId=${encodeURIComponent(projectId)}&stage=${stageId}`');
  });

  it("keeps the complete brief in the center and makes side panels stage-aware", () => {
    expect(workflow).toContain('className="stage-brief-editor"');
    expect(workflow).toContain('<EditableBriefForm');
    expect(workflow).toContain('<ProductImageUploader');
    expect(rail).toContain('activeStage === "brief"');
    expect(rail).toContain('activeStage === "anchors"');
    expect(rail).toContain('activeStage === "keyframes" ? <div className="stage-shot-navigator keyframe-shot-nav"');
    expect(rail).toContain('activeStage === "storyboard" || activeStage === "video"');
  });

  it("stops after each low-cost stage and leaves the old one-click chain without a UI trigger", () => {
    expect(workflow).toContain("runCreativeStage");
    expect(workflow).toContain("runStoryboardStage");
    expect(workflow).not.toContain("onClick={handleGenerate}");
    expect(workflow).toContain("系统不会自动启动下一项昂贵生成");
  });

  it("shows version impact before saving edits to a locked brief", () => {
    expect(workflow).toContain('activeProject.stageStates?.brief.status === "locked"');
    expect(workflow).toContain("setBriefVersionImpact(calculateDependencyImpact");
    expect(workflow).toContain('className="stage-impact-dialog"');
    expect(workflow).toContain("旧内容会保留，受影响的后续结果会显示为需要更新");
    expect(workflow).toContain("不会自动删除素材，也不会自动重新生成全部内容");
  });

  it("covers the required responsive breakpoints", () => {
    for (const breakpoint of ["1180px", "900px", "768px", "390px"]) expect(css).toContain(`max-width:${breakpoint}`);
    expect(css).toContain(".stage-director-rail");
    expect(css).toContain(".stage-inspector{position:fixed");
    expect(css).toContain("overflow-x:auto");
  });
});
