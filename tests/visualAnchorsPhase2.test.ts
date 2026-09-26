import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ id: "anchor-session-a" }));

vi.mock("../lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({ initialized: true as const, session: { id: sessionMock.id } }))
}));

import { GET as getVisualAnchors } from "../app/api/projects/[projectId]/visual-anchors/route";
import { POST as updateWorkflow } from "../app/api/projects/[projectId]/workflow/route";
import { buildProjectContinuity } from "../lib/continuity/projectContinuity";
import { createAnonymousProject, getOwnedAnonymousProject, mutateOwnedAnonymousProject, resetAnonymousProjectQueuesForTests } from "../lib/projects/anonymousProjectStore";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import type { GenerationProject, ProductVisualSpec, StoryboardShot, VisualAnchorCandidate } from "../lib/schemas/project";
import { ensureStageWorkflow, lockStageInProject, setStageStatusInProject } from "../lib/workflow/stageGates";
import { buildCharacterCandidatePrompt, buildSceneCandidatePrompt } from "../lib/visual/anchorPrompts";
import { fallbackCharacterDirections, fallbackSceneDirections } from "../lib/visual/candidateDirections";
import {
  ensureVisualAnchorWorkspace,
  getVisualAnchorSelection,
  getVisualAnchorReadiness,
  lockVisualAnchorMaster,
  replaceVisualAnchorCandidates,
  selectVisualAnchorCandidate
} from "../lib/visual/visualAnchors";
import { canEnterStoryboard, deriveVisualSetupStageState, getVisualSetupBlockers } from "../lib/visual/visualSetupStage";
import { getActionBlockers } from "../lib/workflow/actionBlockers";
import { StageContextPanel, StageDirectorRail, StageInspector } from "../components/StageDirectorRail";
import { VisualAnchorsCanvas } from "../components/VisualAnchorsCanvas";

const originalEnv = { ...process.env };
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const productAssetId = "11111111-1111-4111-8111-111111111111";
const characterAssetIds = [
  "22222222-2222-4222-8222-222222222221",
  "22222222-2222-4222-8222-222222222222",
  "22222222-2222-4222-8222-222222222223"
];
const sceneAssetIds = [
  "33333333-3333-4333-8333-333333333331",
  "33333333-3333-4333-8333-333333333332",
  "33333333-3333-4333-8333-333333333333"
];
let storageRoot = "";

beforeEach(async () => {
  process.env = { ...originalEnv };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-visual-anchors-"));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "visual-anchor-test-salt";
  sessionMock.id = "anchor-session-a";
  resetAnonymousProjectQueuesForTests();
});

afterEach(async () => {
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("Phase 2 visual anchors", () => {
  it("uses the uploaded main product as an exact Product Master and requires an explicit lock", () => {
    let project = anchorProject();
    expect(project.visualAnchorWorkspace?.productMaster).toMatchObject({
      assetId: productAssetId,
      fidelityMode: "exact",
      locked: false
    });
    expect(getVisualAnchorReadiness(project).missingProductReason).toBe("PRODUCT_MASTER_NOT_LOCKED");

    project = lockVisualAnchorMaster(project, "product");
    expect(project.visualAnchorWorkspace?.productMaster.locked).toBe(true);
    expect(project.referencePack?.productMasters).toContain(productAssetId);
  });

  it("keeps three Character Candidates as independent assets and separates Set Current from Lock", () => {
    let project = anchorProject();
    const targetId = project.characterVisualSpecs![0]!.id;
    const candidates = makeCandidates("character", targetId, characterAssetIds);
    project = replaceVisualAnchorCandidates(project, "character", targetId, candidates);
    expect(new Set(project.visualAnchorWorkspace?.characterCandidates.map((item) => item.assetId)).size).toBe(3);

    project = selectVisualAnchorCandidate(project, "character", targetId, candidates[1]!.id);
    expect(project.characterVisualSpecs![0]).toMatchObject({ locked: false });
    expect(project.characterVisualSpecs![0]!.masterAssetId).toBeUndefined();
    expect(project.visualAnchorWorkspace?.characterSelections?.[0]).toMatchObject({ selectedCandidateId: candidates[1]!.id, status: "selected" });
    project = lockVisualAnchorMaster(project, "character", targetId);
    expect(project.characterVisualSpecs![0]).toMatchObject({ masterAssetId: characterAssetIds[1], locked: true });
  });

  it("allows character selection 1 to 2 to 3 to 1 without confirming early", () => {
    let project = anchorProject();
    const targetId = project.characterVisualSpecs![0]!.id;
    const candidates = makeCandidates("character", targetId, characterAssetIds);
    project = replaceVisualAnchorCandidates(project, "character", targetId, candidates);
    for (const index of [0, 1, 2, 0]) {
      project = selectVisualAnchorCandidate(project, "character", targetId, candidates[index]!.id);
      expect(project.visualAnchorWorkspace?.characterSelections?.find((item) => item.targetId === targetId)?.selectedCandidateId).toBe(candidates[index]!.id);
      expect(project.characterVisualSpecs![0]!.locked).toBe(false);
    }
  });

  it("allows scene selection before a character is confirmed", () => {
    let project = anchorProject();
    const sceneId = project.sceneVisualSpecs![0]!.id;
    const candidates = makeCandidates("scene", sceneId, sceneAssetIds);
    project = replaceVisualAnchorCandidates(project, "scene", sceneId, candidates);
    project = selectVisualAnchorCandidate(project, "scene", sceneId, candidates[2]!.id);
    expect(project.visualAnchorWorkspace?.sceneSelections?.[0]).toMatchObject({ selectedCandidateId: candidates[2]!.id, status: "selected" });
    expect(project.visualAnchorWorkspace?.characterSelections?.[0]?.status).not.toBe("confirmed");
  });

  it("preserves an older candidate set when a new set is installed", () => {
    let project = anchorProject();
    const targetId = project.characterVisualSpecs![0]!.id;
    project = replaceVisualAnchorCandidates(project, "character", targetId, makeCandidates("character", targetId, characterAssetIds));
    const next = makeCandidates("character", targetId, sceneAssetIds).map((item) => ({ ...item, version: 2, setVersion: 2 }));
    project = replaceVisualAnchorCandidates(project, "character", targetId, next);
    const all = project.visualAnchorWorkspace!.characterCandidates.filter((item) => item.targetId === targetId);
    expect(all).toHaveLength(6);
    expect(all.filter((item) => item.status === "outdated")).toHaveLength(3);
    expect(project.visualAnchorWorkspace?.characterSelections?.[0]).toMatchObject({ status: "generated", setVersion: 2 });
  });

  it("keeps the previous image for a failed slot during a partial candidate refresh", () => {
    let project = anchorProject();
    const targetId = project.sceneVisualSpecs![0]!.id;
    const original = makeCandidates("scene", targetId, sceneAssetIds).map((item, index) => ({ ...item, candidateIndex: index + 1 }));
    project = replaceVisualAnchorCandidates(project, "scene", targetId, original);
    const refreshed = [original[0]!, original[2]!].map((item, index) => ({
      ...item, id: crypto.randomUUID(), candidateIndex: index === 0 ? 1 : 3,
      assetId: characterAssetIds[index]!, version: 2, setVersion: 2
    }));
    project = replaceVisualAnchorCandidates(project, "scene", targetId, refreshed, new Date().toISOString(), true);
    const active = project.visualAnchorWorkspace!.sceneCandidates.filter((item) => item.targetId === targetId && item.status !== "outdated");
    expect(active.map((item) => item.candidateIndex).sort()).toEqual([1, 2, 3]);
    expect(active.find((item) => item.candidateIndex === 2)?.assetId).toBe(sceneAssetIds[1]);
    expect(active.find((item) => item.candidateIndex === 1)?.assetId).toBe(characterAssetIds[0]);
    expect(active.find((item) => item.candidateIndex === 3)?.assetId).toBe(characterAssetIds[1]);
  });

  it("keeps night and bright states inside one Scene Identity with stable spatial anchors", () => {
    const architecture = buildProjectContinuity({
      brief: coldBrewDemo.brief,
      strategy: coldBrewDemo.strategy,
      shots: [sceneShot("shot-night", 1, "深夜办公室，人物疲惫"), sceneShot("shot-day", 2, "同一办公室变得明亮，人物恢复精神")]
    });
    expect(architecture.shots[0]?.sceneId).toBe(architecture.shots[1]?.sceneId);
    expect(architecture.shots[0]?.sceneStateId).not.toBe(architecture.shots[1]?.sceneStateId);

    const project = ensureVisualAnchorWorkspace({ ...anchorProject(), ...architecture });
    expect(project.sceneVisualSpecs).toHaveLength(1);
    expect(project.sceneVisualSpecs?.[0]?.states?.map((state) => state.timeOfDay)).toEqual(expect.arrayContaining(["night", "day"]));
    expect(project.sceneVisualSpecs?.[0]?.layout?.anchors.length).toBeGreaterThan(0);
  });

  it("opens the Visual Anchor Gate only after Product and every required Character and Scene are locked", () => {
    let project = lockVisualAnchorMaster(anchorProject(), "product");
    const characterId = project.characterVisualSpecs![0]!.id;
    const sceneId = project.sceneVisualSpecs![0]!.id;
    project = replaceVisualAnchorCandidates(project, "character", characterId, makeCandidates("character", characterId, characterAssetIds));
    project = selectVisualAnchorCandidate(project, "character", characterId, project.visualAnchorWorkspace!.characterCandidates[0]!.id);
    project = lockVisualAnchorMaster(project, "character", characterId);
    expect(getVisualAnchorReadiness(project).ready).toBe(false);

    project = replaceVisualAnchorCandidates(project, "scene", sceneId, makeCandidates("scene", sceneId, sceneAssetIds));
    project = selectVisualAnchorCandidate(project, "scene", sceneId, project.visualAnchorWorkspace!.sceneCandidates[0]!.id);
    project = lockVisualAnchorMaster(project, "scene", sceneId);
    expect(getVisualAnchorReadiness(project).ready).toBe(true);
    expect(project.stageStates?.anchors.status).toBe("ready");
    expect(lockStageInProject(project, "anchors").stageStates?.anchors.status).toBe("locked");
  });

  it("derives in-progress until every required visual item is confirmed", () => {
    let project = anchorProject();
    expect(deriveVisualSetupStageState(project).status).toBe("in-progress");
    project = lockVisualAnchorMaster(project, "product");
    const characterId = project.characterVisualSpecs![0]!.id;
    project = replaceVisualAnchorCandidates(project, "character", characterId, makeCandidates("character", characterId, characterAssetIds));
    project = selectVisualAnchorCandidate(project, "character", characterId, project.visualAnchorWorkspace!.characterCandidates[0]!.id);
    project = lockVisualAnchorMaster(project, "character", characterId);
    const state = deriveVisualSetupStageState(project);
    expect(state.status).toBe("in-progress");
    expect(state.productConfirmed).toBe(true);
    expect(state.characterConfirmed).toBe(true);
    expect(state.scenesConfirmed).toBe(false);
    expect(state.blockers.map((item) => item.key)).toEqual(["scene"]);
  });

  it("derives ready-to-complete with no blockers and exposes the final CTA consistently", () => {
    const project = readyVisualSetupProject();
    const state = deriveVisualSetupStageState(project);
    expect(state.status).toBe("ready-to-complete");
    expect(state.allItemsConfirmed).toBe(true);
    expect(getVisualSetupBlockers(project)).toEqual([]);
    expect(getActionBlockers(project, "CONFIRM_VISUAL_SETUP")).toEqual([]);
    expect(canEnterStoryboard(project)).toBe(false);

    const markup = renderVisualSetupFixture(project);
    expect(markup).toContain("可以继续");
    expect(markup).toContain("全部设置已准备完成，等待你确认并继续。");
    expect(markup).toContain("视觉设定已准备完成");
    expect(markup).toContain("确认人物与场景，继续制作分镜");
    expect(markup).toContain("完成情况");
    expect(markup).toContain("✓ 产品");
    expect(markup).toContain("✓ 主角");
    expect(markup).toContain("✓ 场景");
  });

  it("persists final visual setup confirmation and unlocks storyboard after refresh", async () => {
    const created = await createAnonymousProject("anchor-session-a");
    const seeded = await mutateOwnedAnonymousProject("anchor-session-a", created.id, () => persistentReadyVisualSetupProject(), created.version);
    const response = await updateWorkflow(new Request(`http://localhost/api/projects/${created.id}/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm-visual-setup", expectedVersion: seeded.version })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { project: GenerationProject } };
    const confirmed = payload.data.project;
    expect(deriveVisualSetupStageState(confirmed).status).toBe("completed");
    expect(confirmed.stageStates?.anchors.status).toBe("locked");
    expect(confirmed.stageStates?.storyboard.status).toBe("draft");
    expect(canEnterStoryboard(confirmed)).toBe(true);
    expect(confirmed.generationEvents?.at(-1)?.message).toBe("人物与场景设置已确认。");

    resetAnonymousProjectQueuesForTests();
    const restored = await getOwnedAnonymousProject("anchor-session-a", created.id);
    expect(restored && deriveVisualSetupStageState(restored.project).status).toBe("completed");
    expect(restored && canEnterStoryboard(restored.project)).toBe(true);
    const markup = renderVisualSetupFixture(restored!.project);
    expect(markup).toContain("人物与场景已完成");
    expect(markup).toContain("进入分镜制作");
    expect(markup).toContain("制作分镜");
  });

  it("keeps locked scene identity and asset when a later storyboard changes shot-level scene names", async () => {
    const created = await createAnonymousProject("anchor-session-a");
    const ready = lockStageInProject(persistentReadyVisualSetupProject(), "anchors");
    const sceneId = ready.visualAnchorWorkspace!.requiredSceneIds[0]!;
    const masterAssetId = ready.sceneVisualSpecs!.find((item) => item.id === sceneId)!.masterAssetId;
    const characterAssetId = ready.characterVisualSpecs![0]!.masterAssetId;
    const seeded = await mutateOwnedAnonymousProject("anchor-session-a", created.id, () => ready, created.version);
    const updated = await mutateOwnedAnonymousProject("anchor-session-a", created.id, (project) => ({
      ...project,
      shots: project.shots.map((shot, index) => ({
        ...shot,
        sceneId: `new-shot-scene-${index + 1}`,
        sceneGroupId: `new-shot-scene-${index + 1}`,
        sceneStateId: `new-shot-scene-${index + 1}-day`
      }))
    }), seeded.version);
    expect(updated.project.shots.every((shot) => shot.sceneId === sceneId)).toBe(true);
    expect(updated.project.sceneVisualSpecs?.find((item) => item.id === sceneId)).toMatchObject({ masterAssetId, locked: true });
    expect(updated.project.characterVisualSpecs?.[0]).toMatchObject({ masterAssetId: characterAssetId, locked: true });
    expect(deriveVisualSetupStageState(updated.project).status).toBe("completed");
    expect(updated.project.stageStates?.anchors.status).toBe("locked");
    resetAnonymousProjectQueuesForTests();
    const restored = await getOwnedAnonymousProject("anchor-session-a", created.id);
    expect(restored && deriveVisualSetupStageState(restored.project).status).toBe("completed");
    expect(restored?.project.visualAnchorWorkspace?.requiredSceneIds).toContain(sceneId);
  });

  it("confirms only a generated frame and preserves its lock after reload", async () => {
    const created = await createAnonymousProject("anchor-session-a");
    const ready = projectWithOneLockedStoryboardFrame();
    const shot = ready.shots[0]!;
    const frame = shot.frames![0]!;
    const seeded = await mutateOwnedAnonymousProject("anchor-session-a", created.id, () => ({
      ...ready,
      keyframes: [{
        shotId: shot.id,
        frameId: frame.id,
        assetId: "66666666-6666-4666-8666-666666666666",
        localUrl: `/api/projects/${created.id}/assets/66666666-6666-4666-8666-666666666666`,
        status: "ready" as const,
        fallbackUsed: false,
        storageTransition: "PRIVATE_ASSET_V1" as const
      }]
    }), created.version);
    const response = await updateWorkflow(new Request(`http://localhost/api/projects/${created.id}/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-frame-lock", expectedVersion: seeded.version, shotId: shot.id, frameId: frame.id, locked: true })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { project: GenerationProject } };
    expect(payload.data.project.shots[0]?.frames?.[0]?.isLocked).toBe(true);
    expect(payload.data.project.stageStates?.anchors.status).toBe("locked");
    resetAnonymousProjectQueuesForTests();
    const restored = await getOwnedAnonymousProject("anchor-session-a", created.id);
    expect(restored?.project.shots[0]?.frames?.[0]?.isLocked).toBe(true);
  });

  it("rejects frame confirmation when no real keyframe asset exists", async () => {
    const created = await createAnonymousProject("anchor-session-a");
    const ready = projectWithOneLockedStoryboardFrame();
    const seeded = await mutateOwnedAnonymousProject("anchor-session-a", created.id, () => ready, created.version);
    const response = await updateWorkflow(new Request(`http://localhost/api/projects/${created.id}/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-frame-lock", expectedVersion: seeded.version, shotId: ready.shots[0]!.id, frameId: ready.shots[0]!.frames![0]!.id, locked: true })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(400);
    const payload = await response.json() as { error: { message: string } };
    expect(payload.error.message).toBe("当前帧还没有可确认的关键帧图片。");
  });

  it("rejects final visual setup confirmation when a required item is not confirmed", async () => {
    const created = await createAnonymousProject("anchor-session-a");
    const ready = persistentReadyVisualSetupProject();
    const sceneId = ready.sceneVisualSpecs![0]!.id;
    const confirmedCandidateId = getVisualAnchorSelection(ready, "scene", sceneId)!.confirmedCandidateId;
    const alternative = ready.visualAnchorWorkspace!.sceneCandidates.find((item) => item.targetId === sceneId && item.id !== confirmedCandidateId)!;
    const incomplete = selectVisualAnchorCandidate(ready, "scene", sceneId, alternative.id);
    const seeded = await mutateOwnedAnonymousProject("anchor-session-a", created.id, () => incomplete, created.version);

    const response = await updateWorkflow(new Request(`http://localhost/api/projects/${created.id}/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm-visual-setup", expectedVersion: seeded.version })
    }), { params: Promise.resolve({ projectId: created.id }) });
    const payload = await response.json() as { error: { code: string; message: string } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("VISUAL_ANCHORS_INCOMPLETE");
    expect(payload.error.message).toContain("还需要确认场景");
  });

  it("leaves completed state when a confirmed character selection changes", () => {
    let project = lockStageInProject(readyVisualSetupProject(), "anchors");
    const characterId = project.characterVisualSpecs![0]!.id;
    const alternative = project.visualAnchorWorkspace!.characterCandidates.find((item) => item.targetId === characterId && item.id !== getVisualAnchorSelection(project, "character", characterId)?.confirmedCandidateId)!;
    project = selectVisualAnchorCandidate(project, "character", characterId, alternative.id);
    expect(deriveVisualSetupStageState(project).status).toBe("outdated");
    expect(canEnterStoryboard(project)).toBe(false);
  });

  it("maps an old locked visual-anchor stage to completed", () => {
    const current = lockStageInProject(readyVisualSetupProject(), "anchors");
    const legacy = { ...current, visualAnchorWorkspace: undefined };
    expect(deriveVisualSetupStageState(legacy).status).toBe("completed");
    expect(deriveVisualSetupStageState(legacy).blockers).toEqual([]);
  });

  it("builds candidate prompts that forbid multi-person sheets, scene panels and generated text", () => {
    const project = anchorProject();
    const characterPrompt = buildCharacterCandidatePrompt(project.visualAnchorWorkspace!.characterBriefs[0]!, fallbackCharacterDirections(project.visualAnchorWorkspace!.characterBriefs[0]!)[0]!);
    const scenePrompt = buildSceneCandidatePrompt(project.sceneVisualSpecs![0]!, fallbackSceneDirections(project.sceneVisualSpecs![0]!)[0]!);
    expect(characterPrompt).toContain("一个且只能一个独立人物候选");
    expect(characterPrompt).toContain("不得出现第二个人");
    expect(characterPrompt).toContain("任何可读文字");
    expect(scenePrompt).toContain("一个且只能一个完整空场候选");
    expect(scenePrompt).toContain("固定空间锚点");
    expect(scenePrompt).toContain("不得出现分屏");
    const characterPrompts = fallbackCharacterDirections(project.visualAnchorWorkspace!.characterBriefs[0]!)
      .map((direction) => buildCharacterCandidatePrompt(project.visualAnchorWorkspace!.characterBriefs[0]!, direction));
    const scenePrompts = fallbackSceneDirections(project.sceneVisualSpecs![0]!)
      .map((direction) => buildSceneCandidatePrompt(project.sceneVisualSpecs![0]!, direction));
    expect(new Set(characterPrompts).size).toBe(3);
    expect(new Set(scenePrompts).size).toBe(3);
  });

  it("keeps the Visual Anchors API isolated by anonymous ownership", async () => {
    const created = await createAnonymousProject("anchor-session-b");
    sessionMock.id = "anchor-session-a";
    const response = await getVisualAnchors(
      new Request(`http://localhost/api/projects/${created.id}/visual-anchors`),
      { params: Promise.resolve({ projectId: created.id }) }
    );
    expect(response.status).toBe(404);
  });

  it("uses the adaptive Qwen router for each candidate instead of asking for a contact sheet", async () => {
    const source = await readFile("app/api/projects/[projectId]/visual-anchors/route.ts", "utf8");
    expect(source).toContain("Promise.all(requested.map((candidate) => runCandidate(candidate)))");
    expect(source).toContain("generateQwenImageAdaptive({");
    expect(source).toContain("shotId: `anchor-${body.kind}-${body.targetId}-${candidate.id}${repair ? \"-repair\" : \"\"}`");
    expect(source).toContain("count: z.number().int().min(1).max(3)");
    expect(source).toContain("generateCharacterCandidateDirections");
    expect(source).toContain("inspectCandidateDiversity");
    expect(source).toContain("repairIndexes");
  });
});

function anchorProject(): GenerationProject {
  const mainImage = {
    id: "product-image-main",
    assetId: productAssetId,
    name: "cup.png",
    type: "image/png" as const,
    size: 1024,
    localUrl: `/api/projects/${coldBrewDemo.id}/assets/${productAssetId}`,
    role: "main-product" as const
  };
  const continuity = buildProjectContinuity({
    brief: { ...coldBrewDemo.brief, productImages: [mainImage] },
    strategy: coldBrewDemo.strategy,
    shots: [sceneShot("shot-night", 1, "深夜办公室，职场男性疲惫"), sceneShot("shot-day", 2, "同一办公室明亮起来，职场男性恢复精神")],
    productVisualSpec: productSpec()
  });
  const project = ensureStageWorkflow({
    ...coldBrewDemo,
    ...continuity,
    brief: { ...coldBrewDemo.brief, productImages: [mainImage] },
    productVisualSpec: productSpec(),
    stageStates: {
      brief: { status: "locked", updatedAt: 1, lockedAt: 1, lockedVersion: 1 },
      creative: { status: "locked", updatedAt: 2, lockedAt: 2, lockedVersion: 1 },
      anchors: { status: "draft", updatedAt: 3 },
      storyboard: { status: "blocked", updatedAt: 3 },
      keyframes: { status: "blocked", updatedAt: 3 },
      video: { status: "blocked", updatedAt: 3 },
      final: { status: "blocked", updatedAt: 3 }
    }
  });
  return ensureVisualAnchorWorkspace(project, "2026-09-10T00:00:00.000Z");
}

function readyVisualSetupProject(): GenerationProject {
  let project = lockVisualAnchorMaster(anchorProject(), "product");
  const characterId = project.characterVisualSpecs![0]!.id;
  const sceneId = project.sceneVisualSpecs![0]!.id;
  project = replaceVisualAnchorCandidates(project, "character", characterId, makeCandidates("character", characterId, characterAssetIds));
  project = selectVisualAnchorCandidate(project, "character", characterId, project.visualAnchorWorkspace!.characterCandidates[0]!.id);
  project = lockVisualAnchorMaster(project, "character", characterId);
  project = replaceVisualAnchorCandidates(project, "scene", sceneId, makeCandidates("scene", sceneId, sceneAssetIds));
  project = selectVisualAnchorCandidate(project, "scene", sceneId, project.visualAnchorWorkspace!.sceneCandidates[0]!.id);
  return lockVisualAnchorMaster(project, "scene", sceneId);
}

function persistentReadyVisualSetupProject(): GenerationProject {
  const project = readyVisualSetupProject();
  const thirdShot = { ...project.shots[1]!, id: "shot-day-followup", index: 3, durationSec: 4 };
  return {
    ...project,
    planningConstraints: { shotCount: 3, targetDurationSec: 12, aspectRatio: project.brief.aspectRatio, platform: project.brief.platform },
    shotCount: 3,
    targetDurationSec: 12,
    durationSec: 12,
    brief: { ...project.brief, durationSec: 12 },
    shots: [...project.shots, thirdShot]
  };
}

function projectWithOneLockedStoryboardFrame(): GenerationProject {
  const visualReady = lockStageInProject(persistentReadyVisualSetupProject(), "anchors");
  const first = visualReady.shots[0]!;
  const framed = {
    ...visualReady,
    shots: visualReady.shots.map((shot, index) => index === 0 ? {
      ...shot,
      frames: [{
        id: `${shot.id}-frame-1`, shotId: shot.id, index: 0, role: "start" as const,
        timestampSec: 0, description: shot.visualDescription,
        imagePromptCn: shot.imagePromptCn, imagePromptEn: shot.imagePromptEn,
        status: "pending" as const, isLocked: false
      }]
    } : shot)
  };
  return lockStageInProject(setStageStatusInProject(framed, "storyboard", "ready"), "storyboard");
}

function renderVisualSetupFixture(project: GenerationProject) {
  const noop = () => undefined;
  return renderToStaticMarkup(createElement("div", null,
    createElement(StageDirectorRail, { project, activeStage: "anchors", states: project.stageStates!, onSelect: noop }),
    createElement(StageContextPanel, { project, activeStage: "anchors", onSelect: noop }),
    createElement(VisualAnchorsCanvas, {
      project,
      busyTarget: null,
      onInitialize: noop,
      onGenerateAll: noop,
      onConfirmProduct: noop,
      onSetMainProduct: noop,
      onRemoveProductReference: noop,
      onGenerateCandidates: noop,
      onSetCurrent: noop,
      onConfirmTarget: noop,
      onConfirmSelection: noop,
      onEnterStoryboard: noop
    }),
    createElement(StageInspector, { project, activeStage: "anchors", state: project.stageStates!.anchors, busy: false, onLock: noop, onOpenModels: noop, canConfirm: false })
  ));
}

function sceneShot(id: string, index: number, visualDescription: string): StoryboardShot {
  return {
    ...coldBrewDemo.shots[Math.min(index - 1, coldBrewDemo.shots.length - 1)]!,
    id,
    index,
    durationSec: 4,
    goal: visualDescription,
    visualDescription,
    sceneGroupId: "office",
    characterIds: ["character-main"],
    containsProduct: false,
    productIds: []
  };
}

function makeCandidates(kind: "character" | "scene", targetId: string, assetIds: string[]): VisualAnchorCandidate[] {
  return assetIds.map((assetId, index) => ({
    id: `${kind === "character" ? "44444444" : "55555555"}-5555-4555-8555-55555555555${index}`,
    kind,
    targetId,
    assetId,
    label: `Candidate 0${index + 1}`,
    prompt: `${kind} prompt ${index + 1}`,
    status: "ready",
    version: 1,
    createdAt: "2026-09-10T00:00:00.000Z"
  }));
}

function productSpec(): ProductVisualSpec {
  return {
    sourceAssetId: productAssetId,
    containerType: "cup",
    shape: "tapered cup",
    proportions: "1.3:1",
    capStructure: "flat black lid",
    materials: ["paper", "plastic lid"],
    colors: [{ name: "white", hex: "#ffffff" }, { name: "black", hex: "#111111" }],
    labelLayout: "centered front label",
    logoPosition: "front center",
    readablePackagingText: [],
    heroAngle: "front three-quarter",
    forbiddenContainerTypes: ["bottle", "can", "carton", "jar"],
    forbiddenVariations: ["do not change container geometry"],
    inspectorModel: "qwen3.7-plus",
    inspectedAt: "2026-09-10T00:00:00.000Z"
  };
}
