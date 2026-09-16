import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  STORYBOARD_SCHEMA_VERSION,
  normalizeStoryboardOutput,
  storyboardContractExample,
  storyboardShotSchema,
  validateStateContinuity
} from "../lib/ai/contracts/storyboard";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { generationProjectSchema } from "../lib/schemas/project";
import { validateShotConfiguration } from "../lib/video/shotConfig";

describe("storyboard canonical contract", () => {
  it("accepts emotion, expression, gaze and hand state as distinct canonical fields", () => {
    const shot = storyboardContractExample(1, 5);
    const parsed = storyboardShotSchema.parse(shot);
    expect(parsed.sceneStateAfter?.characterStates[0]).toMatchObject({
      characterId: "character-main",
      gaze: "看向产品",
      expression: "眉眼略放松",
      emotion: "疲惫但开始恢复",
      energyLevel: "逐步提升",
      handState: "右手轻触产品"
    });
  });

  it("normalizes allowlisted aliases and records a warning", () => {
    const shot = storyboardContractExample(1, 5) as Record<string, any>;
    shot.sceneStateAfter.characterStates[0].mood = "疲惫但开始恢复";
    delete shot.sceneStateAfter.characterStates[0].emotion;
    const normalized = normalizeStoryboardOutput({ shots: [shot] });
    const normalizedShot = (normalized.value as { shots: unknown[] }).shots[0];

    expect(storyboardShotSchema.parse(normalizedShot).sceneStateAfter?.characterStates[0].emotion).toBe("疲惫但开始恢复");
    expect(normalized.warnings).toContainEqual(expect.objectContaining({ alias: "mood", canonical: "emotion" }));
  });

  it("does not silently remove an unknown field", () => {
    const shot = storyboardContractExample(1, 5) as Record<string, any>;
    shot.sceneStateAfter.characterStates[0].completelyInventedField = "不可静默吞掉";
    const normalized = normalizeStoryboardOutput({ shots: [shot] });
    const normalizedShot = (normalized.value as { shots: unknown[] }).shots[0];

    expect((normalizedShot as Record<string, any>).sceneStateAfter.characterStates[0].completelyInventedField).toBe("不可静默吞掉");
    expect(storyboardShotSchema.safeParse(normalizedShot).success).toBe(false);
  });

  it("validates and round-trips a complete 8-shot 40-second storyboard", () => {
    const shots = Array.from({ length: 8 }, (_, index) => storyboardShotSchema.parse(storyboardContractExample(index + 1, 5)));
    const validation = validateShotConfiguration(8, shots, Array(8).fill(5));
    expect(validation).toMatchObject({ valid: true, totalDurationSec: 40 });
    expect(new Set(shots.map((shot) => shot.id)).size).toBe(8);
    expect(validateStateContinuity(shots)).toEqual({ valid: true, issues: [] });

    const project = generationProjectSchema.parse({
      ...coldBrewDemo,
      shotCount: 8,
      targetDurationSec: 40,
      planningConstraints: { shotCount: 8, targetDurationSec: 40, aspectRatio: coldBrewDemo.brief.aspectRatio, platform: coldBrewDemo.brief.platform },
      brief: { ...coldBrewDemo.brief, durationSec: 40 },
      durationSec: 40,
      shots,
      storyboardContract: { schemaVersion: STORYBOARD_SCHEMA_VERSION, normalizationWarnings: [], continuityWarnings: [], completedShotIndices: [1, 2, 3, 4, 5, 6, 7, 8] }
    });
    const restored = generationProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(restored.storyboardContract?.schemaVersion).toBe(2);
    expect(restored.shots[0]?.sceneStateAfter?.characterStates[0]?.emotion).toBe("疲惫但开始恢复");
  });

  it("migrates legacy holding fields without breaking old projects", () => {
    const shot = storyboardContractExample(1, 5) as Record<string, any>;
    const character = shot.sceneStateAfter.characterStates[0];
    delete character.handState;
    delete character.productInteraction;
    character.holding = "product-master";
    character.holdingHand = "right";
    const parsed = storyboardShotSchema.parse(shot);
    expect(parsed.sceneStateAfter?.characterStates[0]).toMatchObject({
      handState: "右手持握",
      productInteraction: "持有 product-master"
    });
  });

  it("uses Chinese repairing and failed states without exposing raw validation JSON", () => {
    const workflow = readFileSync("components/GenerateWorkflow.tsx", "utf8");
    const route = readFileSync("app/api/generate-storyboard/route.ts", "utf8");
    const rail = readFileSync("components/StageDirectorRail.tsx", "utf8");
    expect(workflow).toContain("正在校正文字分镜结构");
    expect(workflow).toContain("继续生成剩余镜头");
    expect(workflow).toContain("文字分镜生成失败");
    expect(rail).toContain('repairing: "正在整理"');
    expect(route).toContain("文字分镜的数据结构不完整，系统未保存错误结果，请重新生成。");
    expect(route).not.toContain("error: parsed.error.message");
  });
});
