import { describe, expect, it } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { buildOptimizedVideoPrompt } from "../lib/heroVideo";
import {
  DEFAULT_QWEN_NEGATIVE_PROMPT,
  PRODUCT_REFERENCE_QWEN_NEGATIVE_PROMPT,
  buildShotPrompt
} from "../lib/providers/qwenImageProvider";
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

  it("forbids generated text without suppressing the uploaded product label texture", () => {
    expect(PRODUCT_REFERENCE_QWEN_NEGATIVE_PROMPT).toContain("乱码");
    expect(PRODUCT_REFERENCE_QWEN_NEGATIVE_PROMPT).toContain("新增文字");
    expect(PRODUCT_REFERENCE_QWEN_NEGATIVE_PROMPT).not.toContain("包装文字");
    const prompt = buildShotPrompt(coldBrewDemo.shots[0], true);
    expect(prompt).toContain("不可修改的图像纹理原样保留");
    expect(prompt).toContain("不要生成伪文字或乱码");
    expect(prompt).toContain("画面任何其他区域都不得出现可读文字");
    expect(prompt).toContain("禁字要求优先级最高");
  });
});
