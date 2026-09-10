import { describe, expect, it } from "vitest";

import { buildProjectContinuity } from "../lib/continuity/projectContinuity";
import { buildVisualMasterSpecs, lockShotVisualMasters, selectLockedMasterAssetIds } from "../lib/continuity/visualMasters";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import type { GenerationProject } from "../lib/schemas/project";

const anchorAssetId = "33333333-3333-4333-8333-333333333333";

function projectWithContinuity(): GenerationProject {
  const architecture = buildProjectContinuity({
    brief: coldBrewDemo.brief,
    strategy: coldBrewDemo.strategy,
    shots: coldBrewDemo.shots
  });
  return { ...coldBrewDemo, ...architecture } as GenerationProject;
}

describe("Character and Scene Master locks", () => {
  it("creates one visual spec per continuity identity", () => {
    const project = projectWithContinuity();
    const specs = buildVisualMasterSpecs(project);
    expect(specs.characterVisualSpecs.length).toBe(project.visualContinuityBible?.characters.length);
    expect(specs.sceneVisualSpecs.length).toBe(project.visualContinuityBible?.scenes.length);
  });

  it("keeps generated masters unlocked before a QA-passed anchor exists", () => {
    const specs = buildVisualMasterSpecs(projectWithContinuity());
    expect(specs.characterVisualSpecs.every((item) => !item.locked)).toBe(true);
    expect(specs.sceneVisualSpecs.every((item) => !item.locked)).toBe(true);
  });

  it("locks the character and scene from the first accepted group anchor", () => {
    const project = projectWithContinuity();
    const shot = project.shots.find((item) => item.characterIds?.length) ?? project.shots[0];
    const locked = lockShotVisualMasters(project, shot, anchorAssetId);
    expect(locked.characterVisualSpecs.some((item) => item.masterAssetId === anchorAssetId && item.locked)).toBe(true);
    expect(locked.sceneVisualSpecs.some((item) => item.masterAssetId === anchorAssetId && item.locked)).toBe(true);
  });

  it("adds accepted anchors to the reference pack", () => {
    const project = projectWithContinuity();
    const locked = lockShotVisualMasters(project, project.shots[0], anchorAssetId);
    expect(locked.referencePack?.sceneMasters).toContain(anchorAssetId);
  });

  it("selects only locked masters relevant to the current shot", () => {
    const project = projectWithContinuity();
    const shot = project.shots[0];
    const locked = lockShotVisualMasters(project, shot, anchorAssetId);
    const nextProject = { ...project, ...locked };
    expect(selectLockedMasterAssetIds(nextProject, shot)).toContain(anchorAssetId);
  });
});
