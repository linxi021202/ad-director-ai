import { describe, expect, it } from "vitest";

import { finalizeKeyframeQA, finalizeVideoQA } from "../lib/visual/visualQA";

const base = {
  id: "44444444-4444-4444-8444-444444444444",
  shotId: "shot-01",
  assetId: "55555555-5555-4555-8555-555555555555",
  attempt: 1 as const,
  inspectorModel: "qwen3.7-plus",
  checkedAt: "2026-09-06T12:00:00.000Z",
  productMatchPassed: true,
  characterMatchPassed: true,
  sceneMatchPassed: true,
  textSafetyPassed: true,
  issues: [] as string[]
};

describe("visual QA hard-failure policy", () => {
  it("passes a keyframe only when every hard check passes", () => {
    expect(finalizeKeyframeQA({ ...base, singleFramePassed: true }).overallPassed).toBe(true);
  });

  it("hard-fails a collage or multi-panel keyframe", () => {
    const result = finalizeKeyframeQA({
      ...base, singleFramePassed: true, singleFullFramePassed: false, panelCount: 2, collageDetected: true
    });
    expect(result.overallPassed).toBe(false);
    expect(result.issues).toContain("MULTI_PANEL_OR_COLLAGE_FAILURE");
  });

  it("hard-fails a wrong product container", () => {
    expect(finalizeKeyframeQA({ ...base, singleFramePassed: true, productMatchPassed: false }).overallPassed).toBe(false);
  });

  it("hard-fails character identity drift", () => {
    expect(finalizeKeyframeQA({ ...base, singleFramePassed: true, characterMatchPassed: false }).overallPassed).toBe(false);
  });

  it("hard-fails scene identity drift", () => {
    expect(finalizeKeyframeQA({ ...base, singleFramePassed: true, sceneMatchPassed: false }).overallPassed).toBe(false);
  });

  it("hard-fails newly generated readable text", () => {
    expect(finalizeKeyframeQA({ ...base, singleFramePassed: true, textSafetyPassed: false }).overallPassed).toBe(false);
  });

  it("ignores an optimistic model-level overall value and recomputes the result", () => {
    const result = finalizeKeyframeQA({ ...base, singleFramePassed: false } as Parameters<typeof finalizeKeyframeQA>[0]);
    expect(result.overallPassed).toBe(false);
  });

  it("passes a video only when shot continuity and temporal stability both pass", () => {
    expect(finalizeVideoQA({
      ...base, singleContinuousShotPassed: true, temporalConsistencyPassed: true
    }).overallPassed).toBe(true);
  });

  it("hard-fails a video cut or montage", () => {
    expect(finalizeVideoQA({
      ...base, singleContinuousShotPassed: false, temporalConsistencyPassed: true
    }).overallPassed).toBe(false);
  });

  it("hard-fails temporal melting or duplication", () => {
    expect(finalizeVideoQA({
      ...base, singleContinuousShotPassed: true, temporalConsistencyPassed: false
    }).overallPassed).toBe(false);
  });

  it("hard-fails product drift in video", () => {
    expect(finalizeVideoQA({
      ...base, singleContinuousShotPassed: true, temporalConsistencyPassed: true, productMatchPassed: false
    }).overallPassed).toBe(false);
  });

  it("hard-fails character drift in video", () => {
    expect(finalizeVideoQA({
      ...base, singleContinuousShotPassed: true, temporalConsistencyPassed: true, characterMatchPassed: false
    }).overallPassed).toBe(false);
  });

  it("hard-fails scene or text drift in video", () => {
    expect(finalizeVideoQA({
      ...base, singleContinuousShotPassed: true, temporalConsistencyPassed: true, sceneMatchPassed: false
    }).overallPassed).toBe(false);
    expect(finalizeVideoQA({
      ...base, singleContinuousShotPassed: true, temporalConsistencyPassed: true, textSafetyPassed: false
    }).overallPassed).toBe(false);
  });
});
