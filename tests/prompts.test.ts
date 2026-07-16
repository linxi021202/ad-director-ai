import { describe, expect, it } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { buildAdScorePrompt, buildPromptGenerationPrompt, buildStoryboardPrompt, buildStrategyPrompt } from "../lib/prompts";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "../lib/prompts/noReadableText";

const promptCases = [
  ["strategy", buildStrategyPrompt(coldBrewDemo.brief)],
  ["storyboard", buildStoryboardPrompt(coldBrewDemo.brief, coldBrewDemo.strategy)],
  ["prompt-generation", buildPromptGenerationPrompt(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots)],
  ["ad-score", buildAdScorePrompt(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots)]
] as const;

const visualPromptCases = [
  buildStoryboardPrompt(coldBrewDemo.brief, coldBrewDemo.strategy),
  buildPromptGenerationPrompt(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots)
];

const allowedModels = ["deepseek-v4-flash", "qwen-image", "happyhorse-1.0-r2v", "remotion"];
const forbiddenModelNames = ["Wan", "Kling", "Hailuo", "fal.ai", "Seedance", "seedance", "manual-pippit", "小云雀"];

describe("DeepSeek prompt pipeline", () => {
  it.each(promptCases)("%s prompt requires json-only Chinese vertical ad output", (_name, prompt) => {
    expect(prompt.toLowerCase()).toContain("json");
    expect(prompt).toContain("Target JSON example");
    expect(prompt).toContain("Simplified Chinese");
    expect(prompt).toContain("Xiaohongshu/Douyin 9:16 vertical short video");
    expect(prompt).toContain("25-30 seconds");
    expect(prompt).toContain("16 Chinese characters");
  });

  it.each(promptCases)("%s prompt keeps the MVP model route allowlist", (_name, prompt) => {
    for (const model of allowedModels) expect(prompt).toContain(model);
    for (const model of forbiddenModelNames) expect(prompt).not.toContain(model);
  });

  it.each(promptCases)("%s prompt reflects one hero video strategy", (_name, prompt) => {
    expect(prompt).toMatch(/only 1 Hero Shot/i);
    expect(prompt).toContain("Qwen-Image keyframes + Remotion image motion");
  });

  it("keeps every visual generation prompt free of readable model-generated text", () => {
    for (const prompt of visualPromptCases) {
      expect(prompt).toContain(NO_READABLE_TEXT_CN);
      expect(prompt).toContain(NO_READABLE_TEXT_EN);
      expect(prompt).toContain("Remotion overlays only");
    }
  });
});
