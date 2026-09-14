import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { coldBrewDemo } from "@/lib/mock/coldBrewDemo";
import { ensureProjectContinuity } from "@/lib/continuity/projectContinuity";
import { assertStoryboardMatchesPlanning, planningDurationPlan, resolveProjectPlanningConstraints } from "@/lib/projects/planningConstraints";
import { creativeDirectionSetPayloadSchema, type CreativeDirection } from "@/lib/schemas/project";
import { allocateShotDurations } from "@/lib/video/shotConfig";
import { ensureVisualAnchorWorkspace } from "@/lib/visual/visualAnchors";
import { validateCreativeDirectionSetQuality } from "@/lib/creative/creativeDirections";

describe("stage-gated quality fix", () => {
  it("keeps the locked 8-shot 40-second plan as the server source of truth", () => {
    const project = {
      ...coldBrewDemo,
      planningConstraints: { shotCount: 8, targetDurationSec: 40, aspectRatio: "9:16" as const, platform: "douyin" as const },
      shotCount: 8,
      targetDurationSec: 40,
      shots: coldBrewDemo.shots.map((shot, index) => ({ ...shot, durationSec: allocateShotDurations(8, 40)[index]! }))
    };
    expect(resolveProjectPlanningConstraints(project)).toEqual(project.planningConstraints);
    expect(planningDurationPlan(project)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(() => assertStoryboardMatchesPlanning(project, project.shots)).not.toThrow();
  });

  it("reports exact planning mismatch codes", () => {
    const plan = allocateShotDurations(8, 40);
    const project = {
      ...coldBrewDemo,
      planningConstraints: { shotCount: 8, targetDurationSec: 40, aspectRatio: "9:16" as const, platform: "douyin" as const },
      shots: coldBrewDemo.shots.map((shot, index) => ({ ...shot, durationSec: plan[index]! }))
    };
    expect(() => assertStoryboardMatchesPlanning(project, project.shots.slice(0, 7))).toThrow("分镜数量");
    expect(() => assertStoryboardMatchesPlanning(project, project.shots.map((shot, index) => index === 0 ? { ...shot, durationSec: 4 } : shot))).toThrow("分镜总时长");
  });

  it("accepts exactly three substantial and diverse creative directions", () => {
    const candidates = ["感官反差", "时间实验", "角色选择"].map((name, index) => direction(name, index));
    expect(creativeDirectionSetPayloadSchema.parse({ candidates, recommendedCandidateId: candidates[1]!.id }).candidates).toHaveLength(3);
    expect(creativeDirectionSetPayloadSchema.safeParse({ candidates: candidates.slice(0, 2), recommendedCandidateId: candidates[0]!.id }).success).toBe(false);
  });

  it("treats similar creative mechanisms as soft quality feedback instead of a schema failure", () => {
    const candidates = ["方向一", "方向二", "方向三"].map((name, index) => ({ ...direction(name, index), creativeMechanism: long("同一种创意机制", 34) }));
    expect(creativeDirectionSetPayloadSchema.safeParse({ candidates, recommendedCandidateId: candidates[0]!.id }).success).toBe(true);
    expect(validateCreativeDirectionSetQuality(candidates).valid).toBe(false);
  });

  it("accepts a concise one-line idea without attaching aggregate depth errors to it", () => {
    const candidates = ["感官反差", "时间实验", "角色选择"].map((name, index) => ({ ...direction(name, index), oneLineIdea: "让清醒自然发生" }));
    expect(creativeDirectionSetPayloadSchema.safeParse({ candidates, recommendedCandidateId: candidates[0]!.id }).success).toBe(true);
  });

  it("keeps all continuity scenes but requires at most the main and necessary product-display scene", () => {
    const project = { ...coldBrewDemo, ...ensureProjectContinuity(coldBrewDemo) };
    const workspace = ensureVisualAnchorWorkspace(project);
    expect(workspace.sceneVisualSpecs?.length).toBe(project.visualContinuityBible?.scenes.length);
    expect(workspace.visualAnchorWorkspace?.requiredSceneIds.length).toBeGreaterThan(0);
    expect(workspace.visualAnchorWorkspace?.requiredSceneIds.length).toBeLessThanOrEqual(2);
  });

  it("exposes four user steps while retaining seven internal stages", () => {
    const rail = readFileSync("components/StageDirectorRail.tsx", "utf8");
    for (const label of ["商品与创意", "人物与场景", "分镜制作", "视频与成片"]) expect(rail).toContain(label);
    expect(rail).toContain('["brief", "creative"]');
    expect(rail).toContain('["storyboard", "keyframes"]');
  });

  it("keeps successful visual assets when sibling requests fail", () => {
    const route = readFileSync("app/api/projects/[projectId]/visual-anchors/route.ts", "utf8");
    expect(route).toContain("Promise.all(requested.map((candidate)");
    expect(route).toContain(".catch((error) =>");
    expect(route).toContain("successful.length === 0");
    expect(route).toContain("成功候选");
  });
});

function direction(name: string, index: number): CreativeDirection {
  return {
    id: `creative-${index + 1}`,
    title: name,
    oneLineIdea: long(`${name}一句话构想`, 28),
    audienceTension: long(`${name}用户张力`, 29),
    coreInsight: long(`${name}核心洞察`, 28),
    bigIdea: long(`${name}核心创意`, 28),
    creativeMechanism: long(`${name}独立机制`, 32),
    visualMetaphor: long(`${name}视觉隐喻`, 28),
    storyArc: long(`${name}故事走向`, 36),
    openingHook: long(`${name}开场钩子`, 26),
    productEntrance: long(`${name}产品入场`, 26),
    visualHook: long(`${name}视觉钩子`, 29),
    productRole: long(`${name}产品角色`, 27),
    emotionalTurn: long(`${name}情绪转折`, 28),
    heroMoment: long(`${name}产品高光`, 31),
    endingIdea: long(`${name}结尾构想`, 26),
    visualStyle: long(`${name}视觉风格`, 26),
    cameraLanguage: long(`${name}镜头语言`, 26),
    pacingStrategy: long(`${name}节奏策略`, 26),
    whyItWorks: long(`${name}有效原因`, 31),
    differenceFromBrief: long(`${name}相比需求新增机制`, 32),
    executionRisk: long(`${name}执行风险`, 23),
    continuityStrategy: long(`${name}连续性策略`, 26)
  };
}

function long(prefix: string, length: number) {
  return `${prefix}${"具体可执行内容".repeat(10)}`.slice(0, length);
}
