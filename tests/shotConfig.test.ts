import { describe, expect, it } from "vitest";

import { getTimelineBoundaries } from "../lib/render/renderProject";
import {
  DEFAULT_FPS,
  DEFAULT_SHOT_COUNT,
  DEFAULT_SHOT_DURATION_SEC,
  MAX_SHOT_COUNT,
  MAX_SHOT_DURATION_SEC,
  MIN_SHOT_COUNT,
  MIN_SHOT_DURATION_SEC,
  allocateShotDurations,
  clampTargetDuration,
  createDefaultShotDurations,
  createShotPromptTimeSegments,
  getAllowedTargetDurationRange,
  getProjectDurationInFrames,
  getProjectDurationSec,
  validateShotConfiguration
} from "../lib/video/shotConfig";

describe("dynamic shot configuration", () => {
  it("uses 8 shots of 5 seconds only as the new-project default", () => {
    expect(DEFAULT_SHOT_COUNT).toBe(8);
    expect(DEFAULT_SHOT_DURATION_SEC).toBe(5);
    expect(createDefaultShotDurations()).toEqual(Array.from({ length: 8 }, () => 5));
    expect(getProjectDurationSec({ shots: createDefaultShotDurations().map((durationSec) => ({ durationSec })) })).toBe(40);
  });

  it("derives the legal target-duration range from the current shot count", () => {
    expect(getAllowedTargetDurationRange(3)).toEqual({ min: 12, max: 24 });
    expect(getAllowedTargetDurationRange(8)).toEqual({ min: 24, max: 60 });
    expect(getAllowedTargetDurationRange(12)).toEqual({ min: 36, max: 60 });
    expect(clampTargetDuration(3, 40)).toBe(24);
    expect(clampTargetDuration(8, 15)).toBe(24);
  });

  it("allocates exact, deterministic and balanced timelines", () => {
    expect(allocateShotDurations(8, 40)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(allocateShotDurations(8, 43)).toEqual([5, 5, 5, 6, 6, 5, 5, 6]);
    expect(allocateShotDurations(5, 31)).toEqual([6, 6, 7, 6, 6]);
    for (const [count, target] of [[3, 12], [8, 41], [12, 60]] as const) {
      const plan = allocateShotDurations(count, target);
      expect(plan).toHaveLength(count);
      expect(plan.reduce((sum, duration) => sum + duration, 0)).toBe(target);
      expect(plan.every((duration) => duration >= 3 && duration <= 8)).toBe(true);
    }
  });

  it.each([MIN_SHOT_COUNT, MAX_SHOT_COUNT])("creates a valid %s-shot duration plan", (shotCount) => {
    const shots = createDefaultShotDurations(shotCount).map((durationSec) => ({ durationSec }));
    expect(shots).toHaveLength(shotCount);
    expect(validateShotConfiguration(shotCount, shots).valid).toBe(true);
  });

  it("rejects shot counts outside 3-12", () => {
    expect(validateShotConfiguration(2, [{ durationSec: 5 }, { durationSec: 5 }]).errors[0]?.code).toBe("INVALID_SHOT_COUNT");
    expect(validateShotConfiguration(13, Array.from({ length: 13 }, () => ({ durationSec: 5 }))).errors[0]?.code).toBe("INVALID_SHOT_COUNT");
  });

  it("accepts 3 and 8 seconds and rejects values outside that range", () => {
    expect(validateShotConfiguration(3, [{ durationSec: 3 }, { durationSec: 5 }, { durationSec: 8 }]).valid).toBe(true);
    expect(validateShotConfiguration(3, [{ durationSec: 2 }, { durationSec: 5 }, { durationSec: 8 }]).errors[0]?.code).toBe("INVALID_SHOT_DURATION");
    expect(validateShotConfiguration(3, [{ durationSec: 3 }, { durationSec: 5 }, { durationSec: 9 }]).errors[0]?.code).toBe("INVALID_SHOT_DURATION");
    expect(MIN_SHOT_DURATION_SEC).toBe(3);
    expect(MAX_SHOT_DURATION_SEC).toBe(8);
  });

  it("creates duration-aware three-phase Hero Shot timing", () => {
    expect(createShotPromptTimeSegments(3)).toEqual([
      { startSec: 0, endSec: 1 },
      { startSec: 1, endSec: 2 },
      { startSec: 2, endSec: 3 }
    ]);
    expect(createShotPromptTimeSegments(5)).toEqual([
      { startSec: 0, endSec: 1 },
      { startSec: 1, endSec: 3 },
      { startSec: 3, endSec: 5 }
    ]);
    expect(createShotPromptTimeSegments(8)).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 2, endSec: 5 },
      { startSec: 5, endSec: 8 }
    ]);
  });
  it("calculates a 26-second, 780-frame contiguous timeline", () => {
    const durations = [3, 5, 8, 4, 6];
    const shots = durations.map((durationSec, index) => ({ id: `shot-${index + 1}`, durationSec }));
    expect(getProjectDurationSec({ shots })).toBe(26);
    expect(getProjectDurationInFrames({ shots }, DEFAULT_FPS)).toBe(780);
    expect(getTimelineBoundaries(shots)).toEqual([
      { id: "shot-1", startSec: 0, endSec: 3, durationSec: 3 },
      { id: "shot-2", startSec: 3, endSec: 8, durationSec: 5 },
      { id: "shot-3", startSec: 8, endSec: 16, durationSec: 8 },
      { id: "shot-4", startSec: 16, endSec: 20, durationSec: 4 },
      { id: "shot-5", startSec: 20, endSec: 26, durationSec: 6 }
    ]);
  });
});
