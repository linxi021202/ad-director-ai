import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const projectDetail = readFileSync("components/ProjectDetailView.tsx", "utf8");
const workspaceCss = readFileSync("app/workspace-v3.css", "utf8");

describe("generate workflow shot count interaction", () => {
  it("keeps direct shot count editing available for draft projects", () => {
    expect(workflow).toContain("<ShotCountControl value={shotCount}");
    expect(workflow).toContain("onShotCountChange={updateShotCount}");
    expect(workflow).toContain("MIN_SHOT_COUNT");
    expect(workflow).toContain("MAX_SHOT_COUNT");
    expect(workflow).toContain('type="number"');
    expect(workflow).toContain('inputMode="numeric"');
    expect(workflow).toContain("hasGeneratedStoryboard(activeProject)");
    expect(workflow).toContain("if (shotCountSaving || isGenerating) return;");
    expect(workflow).not.toContain("if (shotCountSaving || isGenerating || generated) return;");
  });

  it("keeps brief edits in draft state until the explicit server save succeeds", () => {
    expect(workflow).toContain("const [briefDraft");
    expect(workflow).toContain('setBriefSaveStatus("dirty")');
    expect(workflow).toContain("saveProjectBriefWithConflictRetry(activeProject.id, activeVersionRef.current, briefDraft)");
    expect(workflow).toContain("await projectWriteQueueRef.current");
    expect(workflow).toContain("onPersistedVersion={trackServerVersion}");
    expect(workflow).toContain("projectWriteQueueRef.current = operation.then");
    expect(workflow).not.toContain("setWorkflowSteps((current)");
    expect(workflow).toContain("保存广告需求");
    expect(workflow).toContain('briefSaveStatus !== "saved"');
    expect(workflow).toContain('router.replace(`/generate?projectId=${encodeURIComponent(refreshed.id)}`)');
  });

  it("shows target duration as a precise number stepper", () => {
    expect(workflow).toContain("<TargetDurationControl");
    expect(workflow).toContain("getAllowedTargetDurationRange(shotCount)");
    expect(workflow).toContain("目标时长");
    expect(workflow).toContain("可设置总时长");
  });

  it("keeps platform implicit and gives aspect ratio a full-width row", () => {
    expect(workflow).not.toContain("<span>平台</span>");
    expect(workflow).toContain('className="ad-brief-aspect-field"');
    expect(workspaceCss).toContain(".brief-panel-v3 .ad-brief-aspect-field { grid-column: 1 / -1; }");
  });

  it("keeps the number between the stepper buttons readable", () => {
    expect(workspaceCss).toContain('.shot-count-stepper input[type="number"]');
    expect(workspaceCss).toContain("-webkit-text-fill-color: #f8fafc");
    expect(workspaceCss).toContain("font-variant-numeric: tabular-nums");
    expect(workspaceCss).toContain("grid-template-columns: 30px minmax(28px, 1fr) 30px");
    expect(workspaceCss).toContain("padding: 0 !important");
  });

  it("offers a safe adjustment flow after generation instead of a disabled control", () => {
    expect(workflow).toContain("shot-count-adjust-trigger");
    expect(workflow).toContain("requestGeneratedShotCountChange");
    expect(workflow).toContain("重新生成完整分镜");
    expect(workflow).toContain("regenerateExisting: true");
    expect(workflow).toContain("现有关键帧、导入广告视频和最终成片会失效");
  });

  it("refreshes the server-owned project after rebuilding the storyboard", () => {
    expect(workflow).toContain("fetchServerProject(activeProject.id)");
    expect(workflow).toContain("setLiveKeyframes(projectKeyframesToImages(refreshed))");
  });

  it("prevents duplicate regeneration requests and shows elapsed progress", () => {
    expect(workflow).toContain("shotCountOperationRef.current || shotCountSaving || isGenerating");
    expect(workflow).toContain("shotCountOperationRef.current = true");
    expect(workflow).toContain("shotCountOperationRef.current = false");
    expect(workflow).toContain("shotCountElapsedSec");
    expect(workflow).toContain("20 秒未响应时会自动使用");
    expect(workflow).toContain('setTraceLabel("分镜数量调整失败")');
    expect(projectDetail).toContain("shotCountOperationRef.current || shotCountRegenerating");
    expect(projectDetail).toContain("shotCountElapsedSec");
    expect(projectDetail).toContain("20 秒未响应时会自动使用");
  });
});
