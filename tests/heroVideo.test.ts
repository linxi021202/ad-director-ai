import { describe, expect, it } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import {
  DEFAULT_HERO_SHOT_ID,
  MAX_HERO_VIDEO_SIZE,
  createLocalDemoHeroVideo,
  getHeroVideoStatus,
  resolveHeroShot,
  setProjectHeroShot,
  validateHeroVideoFile
} from "../lib/heroVideo";

describe("hero video state", () => {
  it("defaults heroShotId to shot-3 and resolves Shot 3", () => {
    expect(coldBrewDemo.heroShotId).toBe(DEFAULT_HERO_SHOT_ID);
    expect(resolveHeroShot(coldBrewDemo.shots, coldBrewDemo.heroShotId)?.index).toBe(3);
  });

  it("can switch Hero Shot", () => {
    const next = setProjectHeroShot(coldBrewDemo, coldBrewDemo.shots[1]);

    expect(next.heroShotId).toBe(coldBrewDemo.shots[1].id);
    expect(resolveHeroShot(next.shots, next.heroShotId)?.index).toBe(2);
  });

  it("accepts mp4 upload metadata", () => {
    expect(validateHeroVideoFile({ name: "hero.mp4", type: "video/mp4", size: 1024 })).toEqual({ success: true });
  });

  it("rejects non-video files", () => {
    const result = validateHeroVideoFile({ name: "hero.png", type: "image/png", size: 1024 });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("MP4");
  });

  it("rejects files over 50MB", () => {
    const result = validateHeroVideoFile({ name: "hero.mp4", type: "video/mp4", size: MAX_HERO_VIDEO_SIZE + 1 });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("50MB");
  });

  it("returns to prompt-ready status after deleting video", () => {
    const status = getHeroVideoStatus({ hasHeroShot: true, promptReady: true, videoSource: null, waitingManualUpload: false });

    expect(status).toBe("prompt-ready");
  });

  it("uses /demo-videos/hero-shot.mp4 as demo asset", () => {
    const video = createLocalDemoHeroVideo("/demo-videos/hero-shot.mp4");
    const status = getHeroVideoStatus({ hasHeroShot: true, videoSource: video.source });

    expect(video.source).toBe("local-demo-asset");
    expect(video.path).toBe("/demo-videos/hero-shot.mp4");
    expect(video.fallbackReady).toBe(true);
    expect(status).toBe("using-demo-asset");
  });

  it("supports keyframe fallback state", () => {
    expect(getHeroVideoStatus({ hasHeroShot: true, fallbackToKeyframe: true })).toBe("fallback-to-keyframe");
  });
});

