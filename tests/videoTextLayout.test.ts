import { describe, expect, it } from "vitest";
import { getResponsiveVideoFontSize, getVideoSafeArea } from "../remotion/videoTextLayout";

describe("Remotion text safe areas", () => {
  it("uses the required safe areas for all supported aspect ratios", () => {
    expect(getVideoSafeArea(1080, 1920)).toEqual({ horizontal: 72, bottom: 160 });
    expect(getVideoSafeArea(1920, 1080)).toEqual({ horizontal: 96, bottom: 80 });
    expect(getVideoSafeArea(1080, 1080)).toEqual({ horizontal: 72, bottom: 100 });
  });

  it("shrinks long mixed-language copy instead of clipping it", () => {
    const shortSize = getResponsiveVideoFontSize("subtitle", 1080, "低糖不负担", 936, 2);
    const longSize = getResponsiveVideoFontSize("subtitle", 1080, "AdDirector AI 广告生成 2026，清醒续航，低糖不负担。", 936, 2);
    expect(longSize).toBeLessThanOrEqual(shortSize);
    expect(longSize).toBeGreaterThan(0);
  });
});
