import { describe, expect, it } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { buildOptimizedVideoPrompt } from "../lib/heroVideo";
import { DEFAULT_QWEN_NEGATIVE_PROMPT } from "../lib/providers/qwenImageProvider";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "../lib/prompts/noReadableText";

describe("visual prompt text safety", () => {
  it("adds no-readable-text constraints to every fallback visual prompt", () => {
    for (const shot of coldBrewDemo.shots) {
      expect(shot.imagePromptCn).toContain(NO_READABLE_TEXT_CN);
      expect(shot.imagePromptEn).toContain(NO_READABLE_TEXT_EN);
      expect(shot.videoPromptCn).toContain(NO_READABLE_TEXT_CN);
    }
  });

  it("enforces the same constraints at the Hero video request boundary", () => {
    const prompt = buildOptimizedVideoPrompt(coldBrewDemo.shots[2]);
    expect(prompt).toContain(NO_READABLE_TEXT_CN);
    expect(prompt).toContain(NO_READABLE_TEXT_EN);
    expect(prompt).toContain("Remotion 后期叠加");
  });

  it("includes pseudo-text and package text in the Qwen negative prompt", () => {
    expect(DEFAULT_QWEN_NEGATIVE_PROMPT).toContain("伪文字");
    expect(DEFAULT_QWEN_NEGATIVE_PROMPT).toContain("包装文字");
  });
});
