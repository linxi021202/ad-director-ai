import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ id: "anchor-session-a" }));

vi.mock("../lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({ initialized: true as const, session: { id: sessionMock.id } }))
}));

import { GET as getVisualAnchors } from "../app/api/projects/[projectId]/visual-anchors/route";
import { buildProjectContinuity } from "../lib/continuity/projectContinuity";
import { createAnonymousProject, resetAnonymousProjectQueuesForTests } from "../lib/projects/anonymousProjectStore";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import type { GenerationProject, ProductVisualSpec, StoryboardShot, VisualAnchorCandidate } from "../lib/schemas/project";
import { ensureStageWorkflow, lockStageInProject } from "../lib/workflow/stageGates";
import { buildCharacterCandidatePrompt, buildSceneCandidatePrompt } from "../lib/visual/anchorPrompts";
import {
  ensureVisualAnchorWorkspace,
  getVisualAnchorReadiness,
  lockVisualAnchorMaster,
  replaceVisualAnchorCandidates,
  selectVisualAnchorCandidate
} from "../lib/visual/visualAnchors";

const originalEnv = { ...process.env };
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
    expect(project.characterVisualSpecs![0]).toMatchObject({ masterAssetId: characterAssetIds[1], locked: false });
    project = lockVisualAnchorMaster(project, "character", targetId);
    expect(project.characterVisualSpecs![0]).toMatchObject({ masterAssetId: characterAssetIds[1], locked: true });
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

  it("builds candidate prompts that forbid multi-person sheets, scene panels and generated text", () => {
    const project = anchorProject();
    const characterPrompt = buildCharacterCandidatePrompt(project.visualAnchorWorkspace!.characterBriefs[0]!, 1);
    const scenePrompt = buildSceneCandidatePrompt(project.sceneVisualSpecs![0]!, 1);
    expect(characterPrompt).toContain("一个且只能一个独立人物候选");
    expect(characterPrompt).toContain("不得出现第二个人");
    expect(characterPrompt).toContain("任何可读文字");
    expect(scenePrompt).toContain("一个且只能一个完整空场候选");
    expect(scenePrompt).toContain("固定空间锚点");
    expect(scenePrompt).toContain("不得出现分屏");
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

  it("issues one Qwen call per candidate instead of asking for a contact sheet", async () => {
    const source = await readFile("app/api/projects/[projectId]/visual-anchors/route.ts", "utf8");
    expect(source).toContain("Promise.all(requested.map((candidate) => callQwenImage");
    expect(source).toContain("shotId: `anchor-${body.kind}-${body.targetId}-${candidate.id}`");
    expect(source).toContain("count: z.number().int().min(2).max(3)");
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
