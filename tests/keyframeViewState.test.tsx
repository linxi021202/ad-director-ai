import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { ensureShotArchitecture } from "../lib/storyboard/shotArchitecture";
import { getMissingKeyframeIds, getProjectKeyframeViewState, getShotKeyframeViewState } from "../lib/image/keyframeViewState";
import { KeyframeStageWorkspace } from "../components/KeyframeStageWorkspace";
import { StageContextPanel } from "../components/StageDirectorRail";
import type { GenerationProject } from "../lib/schemas/project";

function fixture(): GenerationProject {
  const shots = coldBrewDemo.shots.slice(0, 3).map((shot, index) => ensureShotArchitecture({ ...shot, id: `shot-0${index + 1}`, frames: undefined }));
  const keyframes = shots.slice(0, 2).flatMap((shot) => shot.frames!.map((frame) => ({ shotId: shot.id, frameId: frame.id,
    assetId: "39140ba7-d72a-4110-bbc0-957701a731f0", localUrl: `/generated/${frame.id}.png`, status: "ready" as const,
    fallbackUsed: false, storageTransition: "PRIVATE_ASSET_V1" as const })));
  return { ...coldBrewDemo, shots, keyframes, shotPromptPackages: [], shotPromptDrafts: [], generationEvents: [] };
}
const noop = () => undefined;
describe("canonical keyframe views", () => {
  it("shows generated-but-unconfirmed shots 01/02 and a genuinely empty shot 03 consistently", () => {
    const project = fixture();
    const nav = renderToStaticMarkup(<StageContextPanel project={project} activeStage="keyframes" />);
    expect(nav.match(/已生成待确认/g)).toHaveLength(2);
    expect(nav.match(/待生成/g)).toHaveLength(1);
    for (const shot of project.shots) {
      const html = renderToStaticMarkup(<KeyframeStageWorkspace project={project} selectedShotId={shot.id} busyShotId={null} error={null} onGenerate={noop} onConfirm={noop} />);
      if (shot.index < 3) {
        expect(html).toContain(`/generated/${shot.frames![0]!.id}.png`);
        expect(html).not.toContain("当前镜头还没有关键帧");
        expect(html).toContain("已生成待确认");
      } else expect(html).toContain("当前镜头提示词尚未完成");
    }
  });
  it("preserves persisted results on reload and targets only missing or failed frames", () => {
    const project = fixture();
    expect(getMissingKeyframeIds(project, "shot-01")).toEqual([]);
    expect(getMissingKeyframeIds(project, "shot-03")).toEqual(project.shots[2]!.frames!.map((frame) => frame.id));
    expect(getShotKeyframeViewState(JSON.parse(JSON.stringify(project)), "shot-02").keyframeGenerationStatus).toBe("completed");
    const second = project.keyframes!.find((item) => item.shotId === "shot-01")!;
    second.status = "failed";
    expect(getMissingKeyframeIds(project, "shot-01")).toEqual([second.frameId]);
    expect(getShotKeyframeViewState(project, "shot-01").keyframeGenerationStatus).toBe("partial");
  });
  it("displays a generated QA-pending image without requiring user confirmation", () => {
    const project = fixture();
    project.keyframes![0]!.status = "generated";
    const view = getShotKeyframeViewState(project, "shot-01");
    expect(view.hasAnyKeyframe).toBe(true);
    expect(view.frameViews[0]!.assetStatus).toBe("persisted");
    expect(view.confirmationStatus).toBe("unconfirmed");
    const html = renderToStaticMarkup(<KeyframeStageWorkspace project={project} selectedShotId="shot-01" busyShotId={null} error={null} onGenerate={noop} onConfirm={noop} />);
    expect(html).toContain("/generated/shot-01-frame-1.png");
    expect(html).not.toContain("当前镜头还没有关键帧");
  });
  it("never counts ready metadata without a URL or asset as a completed image", () => {
    const project = fixture();
    project.keyframes!.filter((item) => item.shotId === "shot-01").forEach((item) => { delete item.assetId; delete item.localUrl; });
    const view = getShotKeyframeViewState(project, "shot-01");
    expect(view.hasAnyKeyframe).toBe(false);
    expect(view.completedCount).toBe(0);
    expect(view.keyframeGenerationStatus).toBe("failed");
  });
  it("ignores an outdated whole-project completed flag when a shot still has no image", () => {
    const project = fixture();
    project.workflowSteps = { ...project.workflowSteps!, keyframes: "completed" };
    expect(getProjectKeyframeViewState(project)).toMatchObject({ completedShotCount: 2, keyframeGenerationStatus: "partial" });
  });
});
