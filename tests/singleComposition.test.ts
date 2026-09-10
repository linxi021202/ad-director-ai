import { describe, expect, it } from "vitest";

import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { buildShotPrompt } from "../lib/providers/qwenImageProvider";
import {
  SINGLE_FRAME_HARD_CONSTRAINT_CN,
  SINGLE_FRAME_HARD_CONSTRAINT_EN,
  SINGLE_VIDEO_HARD_CONSTRAINT_CN,
  findUnsafeCompositionClauses,
  normalizeSingleCompositionPrompt
} from "../lib/prompts/singleComposition";
import { buildWanRequestBody } from "../lib/video/wanVideoClient";

describe("single-composition generation guard", () => {
  it("injects the exact bilingual full-frame image constraint", () => {
    const prompt = buildShotPrompt(coldBrewDemo.shots[0]);
    expect(prompt).toContain(SINGLE_FRAME_HARD_CONSTRAINT_CN);
    expect(prompt).toContain(SINGLE_FRAME_HARD_CONSTRAINT_EN);
  });

  it("detects positive multi-shot and split-layout instructions", () => {
    expect(findUnsafeCompositionClauses("先展示人物，然后切到产品特写。高级商业摄影。")).toHaveLength(1);
    expect(findUnsafeCompositionClauses("Create a three beat montage, then cut to a packshot.")).toHaveLength(1);
  });

  it("does not flag explicit negative constraints", () => {
    expect(findUnsafeCompositionClauses("禁止拼贴、分屏、蒙太奇或多个镜头。")).toEqual([]);
    expect(findUnsafeCompositionClauses("No collage, split screen, contact sheet, or storyboard.")).toEqual([]);
  });

  it("rewrites unsafe positive composition clauses before provider submission", () => {
    const result = normalizeSingleCompositionPrompt(
      "清晨办公室，真实产品在桌面。先展示人物，然后切到产品特写。冷色商业摄影。",
      "image"
    );
    expect(result.rewritten).toBe(true);
    expect(result.prompt).toContain("清晨办公室");
    expect(result.prompt).toContain("冷色商业摄影");
    expect(result.prompt).not.toContain("切到");
  });

  it("uses one action and one camera move at the Wan boundary", () => {
    const body = buildWanRequestBody({
      projectId: "project-one",
      shotId: "shot-one",
      referenceImages: [{ role: "scene", url: "data:image/png;base64,a2V5ZnJhbWU=" }],
      prompt: "先快速建立人物，中段拿起产品，最后切到产品特写。",
      aspectRatio: "9:16",
      durationSec: 5
    }, "wan2.7-i2v");
    expect(body.input.prompt).toContain(SINGLE_VIDEO_HARD_CONSTRAINT_CN);
    expect(body.input.prompt).not.toContain("最后切到产品特写");
    expect(body.input.media).toHaveLength(1);
  });
});
