import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { ensureShotArchitecture } from "../lib/storyboard/shotArchitecture";
import { getMissingKeyframeIds, getProjectKeyframeViewState, getShotKeyframeViewState } from "../lib/image/keyframeViewState";
import { KeyframeStageWorkspace } from "../components/KeyframeStageWorkspace";
import { StageContextPanel } from "../components/StageDirectorRail";
import { StoryboardTimeline } from "../components/storyboard/StoryboardTimeline";
import { derivePromptStageShotState } from "../lib/workflow/shotPromptProgress";
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
  it("renders accessible storyboard shot buttons and matching card targets from one project", () => {
    const project = fixture();
    const selectedShotId = project.shots[1]!.id;
    const nav = renderToStaticMarkup(<StageContextPanel project={project} activeStage="storyboard" selectedShotId={selectedShotId} onShotSelect={noop} />);
    const cards = renderToStaticMarkup(<StoryboardTimeline project={project} selectedShotId={selectedShotId} />);
    expect(nav.match(/<button type="button"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(nav).toContain('aria-current="location"');
    expect(nav).toContain(`${project.shots[1]!.durationSec} 秒 · 未开始`);
    for (const shot of project.shots) {
      expect(cards).toContain(`data-shot-id="${shot.id}"`);
      expect(derivePromptStageShotState(project, shot.id).status).toBe("not_started");
    }
    expect(cards).toContain(`id="storyboard-shot-${selectedShotId}"`);
  });
  it("shows generated-but-unconfirmed shots 01/02 and a genuinely empty shot 03 consistently", () => {
    const project = fixture();
    const nav = renderToStaticMarkup(<StageContextPanel project={project} activeStage="keyframes" />);
    expect(nav.match(/已生成待确认/g)).toHaveLength(2);
    expect(nav.match(/待生成/g)).toHaveLength(1);
    for (const shot of project.shots) {
      const html = renderToStaticMarkup(<KeyframeStageWorkspace project={project} selectedShotId={shot.id} busyShotId={null} error={null} onGenerate={noop} onConfirm={noop} />);
      if (shot.index < 3) {
        expect(html).toContain(`/api/projects/${project.id}/assets/39140ba7-d72a-4110-bbc0-957701a731f0`);
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
    expect(html).toContain(`/api/projects/${project.id}/assets/39140ba7-d72a-4110-bbc0-957701a731f0`);
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
  it("shows response timeout without inventing a persisted image", () => {
    const project = fixture();
    for (const frame of project.keyframes!.filter((item) => item.shotId === "shot-01")) {
      delete frame.assetId;
      delete frame.localUrl;
      frame.status = "response_timeout";
    }
    const view = getShotKeyframeViewState(project, "shot-01");
    expect(view.frameViews[0]).toMatchObject({ responseTimeout: true, imageUrl: undefined });
    const html = renderToStaticMarkup(<KeyframeStageWorkspace project={project} selectedShotId="shot-01" busyShotId={null} error={null} onGenerate={noop} onConfirm={noop} />);
    expect(html).toContain("图像模型响应超时，本次结果状态未知");
    expect(html).toContain("重新生成当前帧");
    expect(html).not.toContain("/landing-cold-brew-hero.png");
  });
  it("ignores an outdated whole-project completed flag when a shot still has no image", () => {
    const project = fixture();
    project.workflowSteps = { ...project.workflowSteps!, keyframes: "completed" };
    expect(getProjectKeyframeViewState(project)).toMatchObject({ completedShotCount: 2, keyframeGenerationStatus: "partial" });
  });
  it("recovers a persisted frame asset in the project even when its keyframe metadata is missing", () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const frame = shot.frames![0]!;
    frame.assetId = "39140ba7-d72a-4110-bbc0-957701a731f0";
    frame.status = "ready";
    project.keyframes = project.keyframes!.filter((item) => item.frameId !== frame.id);
    const view = getShotKeyframeViewState(project, shot.id);
    expect(view.frameViews[0]?.imageUrl).toContain(frame.assetId);
    expect(view.status).toBe("generated");
    const html = renderToStaticMarkup(<KeyframeStageWorkspace project={project} selectedShotId={shot.id} busyShotId={null} error={null} onGenerate={noop} onConfirm={noop} />);
    expect(html).not.toContain("当前镜头还没有关键帧");
  });
});
