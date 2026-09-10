import { describe, expect, it } from "vitest";

import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN, appendNoReadableTextRules } from "../lib/prompts/noReadableText";
import { finalizeKeyframeQA, finalizeVideoQA } from "../lib/visual/visualQA";
import { buildWanRequestBody } from "../lib/video/wanVideoClient";

const base = {
  id: "11111111-1111-4111-8111-111111111111", shotId: "shot-01", attempt: 1 as const,
  inspectorModel: "qwen3.7-plus", checkedAt: "2026-09-06T12:00:00.000Z", productMatchPassed: true,
  containerTypeMatch: true, silhouetteMatch: true, lidTypeMatch: true, majorGeometryMatch: true,
  dominantColorMatch: true, characterMatchPassed: true, sceneMatchPassed: true, textSafetyPassed: true,
  generatedTextDetected: false, sourceProductTextPreserved: true, issues: []
};

describe("zero generated text", () => {
  it("adds the hard bilingual text policy to every visual prompt", () => {
    const prompt = appendNoReadableTextRules("办公场景");
    expect(prompt).toContain(NO_READABLE_TEXT_CN);
    expect(prompt).toContain(NO_READABLE_TEXT_EN);
    expect(prompt).toContain("屏幕空白");
  });

  it("fails a keyframe when generated-region text is detected", () => {
    expect(finalizeKeyframeQA({ ...base, singleFramePassed: true, generatedTextDetected: true }).overallPassed).toBe(false);
  });

  it("allows original Product Master text when source pixels are preserved", () => {
    expect(finalizeKeyframeQA({ ...base, singleFramePassed: true }).overallPassed).toBe(true);
  });

  it("fails video QA when package or background text mutates", () => {
    expect(finalizeVideoQA({ ...base, singleContinuousShotPassed: true, temporalConsistencyPassed: true, sourceProductTextPreserved: false }).overallPassed).toBe(false);
  });

  it("injects product anti-morphing and text rules into Wan", () => {
    const body = buildWanRequestBody({
      projectId: "project", shotId: "shot", prompt: "缓慢推近", durationSec: 4, aspectRatio: "9:16",
      referenceImages: [{ role: "scene", url: "https://example.com/frame.png" }]
    }, "wan2.7-i2v", "720P");
    expect(body.input.prompt).toContain("产品几何、轮廓、容器类型");
    expect(body.input.prompt).toContain("屏幕空白");
    expect(body.input.prompt).not.toContain("瓶身或包装标签");
  });
});
