import { describe, expect, it } from "vitest";

import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import {
  buildDefaultMicroBeats, buildDefaultShotFrames, buildShotSubclips, buildTimedChoreography,
  ensureShotArchitecture, frameCountForDuration, microBeatRangeForDuration,
  selectShotVideoStrategy, validateMicroBeatTimeline, validateShotContentDensity
} from "../lib/storyboard/shotArchitecture";
import type { StoryboardShot } from "../lib/schemas/project";

function shotAt(durationSec: number): StoryboardShot {
  return { ...coldBrewDemo.shots[0]!, durationSec, containsProduct: true };
}

describe("multi-frame shot architecture", () => {
  it("allocates frame counts by shot duration", () => {
    expect([3, 4, 5, 6, 7, 8].map(frameCountForDuration)).toEqual([2, 3, 4, 4, 5, 5]);
  });

  it("creates four independent frozen frames for a five-second shot", () => {
    const frames = buildDefaultShotFrames(shotAt(5));
    expect(frames).toHaveLength(4);
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(4);
    expect(frames.every((frame) => frame.imagePromptEn.includes("One frozen moment"))).toBe(true);
    expect(frames.every((frame) => frame.imagePromptCn.includes("一个完整画面"))).toBe(true);
  });

  it("creates a dense, non-overlapping five-second micro-beat timeline", () => {
    const shot = ensureShotArchitecture(shotAt(5));
    expect(shot.microBeats).toHaveLength(5);
    expect(validateMicroBeatTimeline(shot)).toBe(true);
    expect(validateShotContentDensity(shot)).toMatchObject({ passed: true, minBeats: 4, maxBeats: 6 });
    expect(shot.microBeats?.every((beat) => beat.complexity <= 4)).toBe(true);
  });

  it("keeps the documented beat ranges for every supported duration", () => {
    expect([3, 4, 5, 6, 7, 8].map(microBeatRangeForDuration)).toEqual([[2, 4], [3, 5], [4, 6], [5, 7], [5, 8], [6, 9]]);
  });

  it("maps a legacy keyframe asset to frame zero without regeneration", () => {
    const assetId = crypto.randomUUID();
    const normalized = ensureShotArchitecture({ ...shotAt(4), keyframeAssetId: assetId });
    expect(normalized.frames?.[0]).toMatchObject({ assetId, status: "ready", isLocked: true });
  });

  it("selects first-last or at most two subclips and emits timed choreography", () => {
    const fiveSecond = ensureShotArchitecture(shotAt(5));
    expect(selectShotVideoStrategy(fiveSecond)).toBe("first-last-frame");
    expect(buildTimedChoreography(fiveSecond)).toContain("[0.00-");
    const longShot = ensureShotArchitecture(shotAt(8));
    const subclips = buildShotSubclips(longShot);
    expect(selectShotVideoStrategy(longShot)).toBe("two-subclips");
    expect(subclips).toHaveLength(2);
    expect(subclips.reduce((sum, clip) => sum + clip.durationSec, 0)).toBe(8);
  });

  it("allows a deliberate pause to use the low density bound", () => {
    expect(buildDefaultMicroBeats({ ...shotAt(5), goal: "情绪停顿并保持余韵" })).toHaveLength(4);
  });
});
