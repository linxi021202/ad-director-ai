import { describe, expect, it } from "vitest";

import {
  DEFAULT_AD_DURATION_SEC,
  DEFAULT_FPS,
  DEFAULT_HERO_SHOT_INDEX,
  DEFAULT_SHOT_COUNT,
  DEFAULT_SHOT_DURATIONS_SEC,
  getDefaultShotDurations,
  getDurationInFrames,
  getProjectDurationSec,
  getShotCountForDuration,
  validateShotDurations
} from "../lib/video/durationConfig";

describe("ad duration configuration", () => {
  it("uses one 40-second, 8-shot source of truth for new projects", () => {
    expect(DEFAULT_AD_DURATION_SEC).toBe(40);
    expect(DEFAULT_SHOT_COUNT).toBe(8);
    expect(DEFAULT_HERO_SHOT_INDEX).toBe(4);
    expect(DEFAULT_SHOT_DURATIONS_SEC).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(DEFAULT_SHOT_DURATIONS_SEC.reduce((sum, value) => sum + value, 0)).toBe(40);
    expect(getDurationInFrames(DEFAULT_SHOT_DURATIONS_SEC.map((durationSec) => ({ durationSec })), DEFAULT_FPS)).toBe(1200);
  });

  it.each([
    [15, 3],
    [20, 4],
    [30, 6],
    [40, 8]
  ])("keeps the legacy %s-second helper compatible with %s default shots", (durationSec, shotCount) => {
    const durations = getDefaultShotDurations(durationSec);
    expect(getShotCountForDuration(durationSec)).toBe(shotCount);
    expect(durations).toHaveLength(shotCount);
    expect(durations).toEqual(Array.from({ length: shotCount }, () => 5));
    expect(validateShotDurations(durations.map((value) => ({ durationSec: value })), durationSec).valid).toBe(true);
  });

  it("preserves a legacy project duration from its persisted shots", () => {
    const legacy = {
      shots: [{ durationSec: 4 }, { durationSec: 5 }, { durationSec: 4 }, { durationSec: 5 }],
      brief: { durationSec: 40 },
      durationSec: 40
    };
    expect(getProjectDurationSec(legacy as never)).toBe(18);
  });
});
