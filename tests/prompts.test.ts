import { describe, expect, it } from "vitest";

import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import {
  buildAdScorePrompt,
  buildPromptGenerationPrompt,
  buildStoryboardChunkPrompt,
  buildStoryboardPrompt,
  buildStrategyPrompt
} from "../lib/prompts";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "../lib/prompts/noReadableText";
import { getDefaultShotDurations } from "../lib/video/durationConfig";

const strategyPrompt = buildStrategyPrompt(coldBrewDemo.brief);
const storyboardPrompt = buildStoryboardPrompt(coldBrewDemo.brief, coldBrewDemo.strategy);
const generationPrompt = buildPromptGenerationPrompt(
  coldBrewDemo.brief,
  coldBrewDemo.strategy,
  coldBrewDemo.shots
);
const scorePrompt = buildAdScorePrompt(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots);

describe("DeepSeek prompt pipeline", () => {
  it.each([
    ["strategy", strategyPrompt],
    ["storyboard", storyboardPrompt],
    ["prompt-generation", generationPrompt],
    ["ad-score", scorePrompt]
  ])("%s prompt requests structured JSON for the selected duration", (_name, prompt) => {
    expect(prompt.toLowerCase()).toContain("json");
    expect(prompt).toContain(String(coldBrewDemo.brief.durationSec));
  });

  it("derives the storyboard count and durations from the 40-second project", () => {
    expect(storyboardPrompt).toContain(String(coldBrewDemo.shots.length));
    expect(storyboardPrompt).toContain(getDefaultShotDurations(40).join("、"));
    expect(generationPrompt).toContain(String(coldBrewDemo.shots.length));
  });

  it("keeps storyboard chunks structural and leaves detailed prompts for per-shot expansion", () => {
    const chunk = buildStoryboardChunkPrompt(coldBrewDemo.brief, coldBrewDemo.strategy, {
      shotDurationPlan: [5, 5, 5, 5],
      shotIndexOffset: 0,
      totalShotCount: 8,
      totalDurationSec: 40
    });
    expect(chunk).toContain("只生成文字分镜结构");
    expect(chunk).toContain("第 1-4 镜");
    expect(chunk).toContain("详细 Qwen 图片提示词、Wan 视频提示词");
    expect(chunk).not.toContain('"frames":');
    expect(chunk).not.toContain('"microBeats":');
  });

  it("keeps visual model prompts free of readable model-generated text", () => {
    for (const prompt of [storyboardPrompt, generationPrompt]) {
      expect(prompt).toContain(NO_READABLE_TEXT_CN);
      expect(prompt).toContain(NO_READABLE_TEXT_EN);
      expect(prompt).toContain("Remotion");
    }
  });

  it("requires continuity state, separated constraints and verified claims", () => {
    expect(strategyPrompt).toContain("verifiedClaims");
    for (const prompt of [storyboardPrompt, generationPrompt]) {
      expect(prompt).toContain("continuityGroupId");
      expect(prompt).toContain("sceneStateBefore");
      expect(prompt).toContain("continuityConstraints");
      expect(prompt).toContain("shotDirection");
      expect(prompt).toContain("verifiedClaims");
    }
  });

  it("keeps the current primary provider chain", () => {
    const combined = [strategyPrompt, storyboardPrompt, generationPrompt, scorePrompt].join("\n");
    for (const model of ["deepseek-v4-pro", "qwen-image", "wan2.7-i2v", "remotion"]) {
      expect(combined).toContain(model);
    }
    for (const forbidden of ["HappyHorse", "Kling", "Hailuo", "fal.ai", "Seedance", "manual-pippit"]) {
      expect(combined).not.toContain(forbidden);
    }
  });
});
