import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KeyframeStageWorkspace } from "../components/KeyframeStageWorkspace";
import { VisualAssetPlaceholder } from "../components/VisualAssetPlaceholder";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { ensureShotArchitecture } from "../lib/storyboard/shotArchitecture";

describe("keyframe production workspace", () => {
  const shot = ensureShotArchitecture(coldBrewDemo.shots[0]!);
  const project = { ...coldBrewDemo, shots: [shot] };
  const noop = () => undefined;

  it("shows one real-ratio pending frame and an in-place generation action", () => {
    const html = renderToStaticMarkup(<KeyframeStageWorkspace project={project} keyframes={[]} busyShotId={null} error={null} onGenerate={noop} onConfirm={noop} />);
    expect(html).toContain("关键帧待生成");
    expect(html).toContain("当前镜头还没有关键帧");
    expect(html).toContain("生成关键帧");
    expect(html).toContain("镜头日志");
    expect(html).toContain(`aspect-ratio:${project.brief.aspectRatio.replace(":", " / ")}`);
    expect(html).not.toContain("demo-keyframes");
  });

  it("renders only the selected frame, not a contact sheet", () => {
    const frames = Array.from({ length: 4 }, (_, index) => ({ ...shot.frames![0]!, id: `frame-${index + 1}`, index }));
    const fourFrameProject = { ...project, shots: [{ ...shot, frames }] };
    const current = frames[0]!;
    const other = frames[1]!;
    const html = renderToStaticMarkup(<KeyframeStageWorkspace project={fourFrameProject} keyframes={[
      { shotId: shot.id, frameId: current.id, localUrl: "/first.png", status: "ready" },
      { shotId: shot.id, frameId: other.id, localUrl: "/second.png", status: "ready" }
    ]} busyShotId={null} error={null} onGenerate={noop} onConfirm={noop} />);
    expect(html).toContain("/first.png");
    expect(html).not.toContain("/second.png");
    expect(html).toContain("1 / 4");
  });

  it("uses the same placeholder component in refinement and production", () => {
    const html = renderToStaticMarkup(<VisualAssetPlaceholder title="预览待生成" description="完成对应生成步骤后，这里将显示预览。" aspectRatio="16:9" />);
    expect(html).toContain("visual-asset-placeholder");
    expect(html).toContain("aspect-ratio:16 / 9");
  });
});
