import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ id: "stage-session-a" }));

vi.mock("../lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({ initialized: true as const, session: { id: sessionMock.id } }))
}));

import { GET as getWorkflow, POST as postWorkflow } from "../app/api/projects/[projectId]/workflow/route";
import {
  createAnonymousProject,
  getOwnedAnonymousProject,
  lockOwnedProjectStage,
  resetAnonymousProjectQueuesForTests,
  saveOwnedProjectBrief,
  setOwnedProjectStageStatus,
  updateOwnedAnonymousProject
} from "../lib/projects/anonymousProjectStore";
import { StageGateError, calculateDependencyImpact } from "../lib/workflow/stageGates";

const originalEnv = { ...process.env };
let storageRoot = "";

beforeEach(async () => {
  process.env = { ...originalEnv };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-stage-gates-"));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "stage-gate-test-salt";
  sessionMock.id = "stage-session-a";
  resetAnonymousProjectQueuesForTests();
});

afterEach(async () => {
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("stage-gated workflow", () => {
  it("starts new projects at brief draft and blocks later stages", async () => {
    const created = await createAnonymousProject(sessionMock.id);

    expect(created.project.stageStates).toMatchObject({
      brief: { status: "draft" },
      creative: { status: "blocked" },
      anchors: { status: "blocked" },
      storyboard: { status: "blocked" },
      keyframes: { status: "blocked" },
      video: { status: "blocked" },
      final: { status: "blocked" }
    });
    expect(created.project.resourceVersions).toEqual([]);
  });

  it("separates server-ready output from user locking and enforces the previous gate", async () => {
    const created = await createAnonymousProject(sessionMock.id);
    const saved = await saveOwnedProjectBrief(sessionMock.id, created.id, {
      brief: created.project.brief,
      shotCount: created.project.shots.length,
      targetDurationSec: created.project.targetDurationSec ?? created.project.brief.durationSec
    }, created.version);

    expect(saved.project.stageStates?.brief.status).toBe("ready");
    expect(saved.project.resourceVersions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "brief:v1", version: 1, status: "current" })
    ]));
    await expect(setOwnedProjectStageStatus(
      sessionMock.id,
      created.id,
      "storyboard",
      "running",
      saved.version
    )).rejects.toMatchObject({ code: "VISUAL_ANCHOR_NOT_LOCKED" });

    const locked = await lockOwnedProjectStage(sessionMock.id, created.id, "brief", saved.version);
    expect(locked.project.stageStates?.brief).toMatchObject({ status: "locked", lockedVersion: 1 });
    expect(locked.project.stageStates?.creative.status).toBe("draft");
    expect(locked.project.generationEvents.at(-1)?.action).toBe("锁定阶段");
  });

  it("requires an explicit V2 when a locked brief changes and marks only dependants outdated", async () => {
    const created = await createAnonymousProject(sessionMock.id);
    const saved = await saveOwnedProjectBrief(sessionMock.id, created.id, {
      brief: created.project.brief,
      shotCount: created.project.shots.length,
      targetDurationSec: created.project.targetDurationSec ?? created.project.brief.durationSec
    }, created.version);
    const briefLocked = await lockOwnedProjectStage(sessionMock.id, created.id, "brief", saved.version);
    const creativeReady = await setOwnedProjectStageStatus(sessionMock.id, created.id, "creative", "ready", briefLocked.version);
    const creativeLocked = await lockOwnedProjectStage(sessionMock.id, created.id, "creative", creativeReady.version);

    const changedInput = {
      brief: { ...creativeLocked.project.brief, productName: "锁定后修改的商品" },
      shotCount: creativeLocked.project.shots.length,
      targetDurationSec: creativeLocked.project.targetDurationSec ?? creativeLocked.project.brief.durationSec
    };
    await expect(saveOwnedProjectBrief(sessionMock.id, created.id, changedInput, creativeLocked.version))
      .rejects.toBeInstanceOf(StageGateError);

    const versioned = await saveOwnedProjectBrief(sessionMock.id, created.id, {
      ...changedInput,
      createVersion: true
    }, creativeLocked.version);
    const briefVersions = versioned.project.resourceVersions?.filter((item) => item.resourceId === "brief") ?? [];
    expect(briefVersions).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: 1, status: "outdated" }),
      expect.objectContaining({ version: 2, status: "current" })
    ]));
    expect(versioned.project.stageStates?.brief.status).toBe("ready");
    expect(versioned.project.stageStates?.creative.status).toBe("outdated");
    expect(versioned.project.dependencyGraph?.find((node) => node.resourceId === "creative-direction")?.status).toBe("outdated");
    expect(versioned.project.brief.productName).toBe("锁定后修改的商品");
    expect(versioned.project.generationEvents.some((event) => event.action === "标记下游过期")).toBe(true);
  });

  it("calculates transitive shot, frame, video, narration and final impact", () => {
    const impact = calculateDependencyImpact([
      node("storyboard", "storyboard", "storyboard", [{ resourceId: "character-master", version: 1 }]),
      { ...node("frame-1", "shot-frame", "keyframes", [{ resourceId: "storyboard", version: 2 }]), shotId: "shot-1", frameId: "frame-1" },
      { ...node("video-1", "shot-video", "video", [{ resourceId: "frame-1", version: 1 }]), shotId: "shot-1", videoId: "video-1" },
      { ...node("narration-1", "narration", "video", [{ resourceId: "storyboard", version: 2 }]), narrationId: "narration-1" },
      node("final", "final", "final", [{ resourceId: "video-1", version: 1 }, { resourceId: "narration-1", version: 1 }])
    ], "character-master", 1, 2);

    expect(impact.affectedStages).toEqual(["storyboard", "keyframes", "video", "final"]);
    expect(impact.affectedShotIds).toEqual(["shot-1"]);
    expect(impact.affectedFrameIds).toEqual(["frame-1"]);
    expect(impact.affectedVideoIds).toEqual(["video-1"]);
    expect(impact.affectedNarrationIds).toEqual(["narration-1"]);
    expect(impact.finalAffected).toBe(true);
  });

  it("keeps workflow reads and locks isolated by anonymous ownership", async () => {
    const created = await createAnonymousProject("stage-session-b");
    sessionMock.id = "stage-session-a";
    const routeContext = { params: Promise.resolve({ projectId: created.id }) };

    const read = await getWorkflow(new Request(`http://localhost/api/projects/${created.id}/workflow?resourceId=brief`), routeContext);
    expect(read.status).toBe(404);

    const lock = await postWorkflow(new Request(`http://localhost/api/projects/${created.id}/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lock-stage", expectedVersion: created.version, stageId: "brief" })
    }), routeContext);
    expect(lock.status).toBe(404);
    expect(await getOwnedAnonymousProject("stage-session-b", created.id)).not.toBeNull();
  });
});

function node(
  resourceId: string,
  resourceType: "storyboard" | "shot-frame" | "shot-video" | "narration" | "final",
  stageId: "storyboard" | "keyframes" | "video" | "final",
  dependsOn: Array<{ resourceId: string; version: number }>
) {
  return { resourceId, resourceType, stageId, version: resourceId === "storyboard" ? 2 : 1, status: "current" as const, dependsOn };
}
