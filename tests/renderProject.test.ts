vi.mock("server-only", () => ({}));

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPrivateAsset,
  resetAssetStoreForTests
} from "../lib/assets/assetStore";
import {
  resetRenderAssetTokensForTests,
  resolveRenderAssetGrant,
  revokeRenderAssetToken
} from "../lib/assets/renderAccess";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import {
  createAnonymousProject,
  requireOwnedAnonymousProject,
  resetAnonymousProjectQueuesForTests,
  updateOwnedAnonymousProject
} from "../lib/projects/anonymousProjectStore";
import {
  getTimelineBoundaries,
  isForbiddenRenderUrl,
  normalizeShotDurations,
  prepareRenderProject,
  resolveShotKeyframeUrl,
  sumShotDurations
} from "../lib/render/renderProject";
import { DEFAULT_DURATION_IN_FRAMES, getCompositionSize } from "../remotion/schemas";
import type { GenerationProject } from "../lib/schemas/project";

const SESSION_ID = "render-private-session";
let storageRoot = "";
let project: GenerationProject;
const originalEnv = { ...process.env };

beforeEach(async () => {
  process.env = { ...originalEnv };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-render-private-"));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "render-private-test-salt";
  resetAnonymousProjectQueuesForTests();
  resetAssetStoreForTests();
  resetRenderAssetTokensForTests();

  const record = await createAnonymousProject(SESSION_ID, { templateId: "cold-brew-demo" });
  const keyframes = [];
  for (const shot of record.project.shots) {
    const asset = await createPrivateAsset(SESSION_ID, record.id, {
      kind: "keyframe",
      source: "qwen-image",
      role: shot.id,
      fileName: `shot-${shot.index}.png`,
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71, shot.index])
    });
    keyframes.push({
      shotId: shot.id,
      assetId: asset.id,
      imageUrl: `/api/projects/${record.id}/assets/${asset.id}`,
      localUrl: `/api/projects/${record.id}/assets/${asset.id}`,
      provider: "dashscope",
      model: "qwen-image",
      fallbackUsed: false,
      status: "ready" as const,
      storageTransition: "PRIVATE_ASSET_V1" as const
    });
  }
  const hero = await createPrivateAsset(SESSION_ID, record.id, {
    kind: "hero-video",
    source: "happyhorse-manual-import",
    role: record.project.heroShotId,
    fileName: "hero-shot.mp4",
    mimeType: "video/mp4",
    bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
    width: 720,
    height: 1280,
    durationSec: 4
  });
  const narration = await createPrivateAsset(SESSION_ID, record.id, {
    kind: "narration-audio",
    source: "user-upload",
    role: "voiceover",
    fileName: "voiceover.wav",
    mimeType: "audio/wav",
    bytes: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69])
  });
  const updated = await updateOwnedAnonymousProject(SESSION_ID, record.id, {
    keyframes,
    narrationAssetId: narration.id,
    heroVideo: {
      shotId: record.project.heroShotId ?? record.project.shots[0]!.id,
      assetId: hero.id,
      source: "happyhorse-manual-import",
      status: "uploaded",
      url: `/api/projects/${record.id}/assets/${hero.id}`,
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: hero.sizeBytes,
      durationSec: 4,
      aspectRatio: "9:16",
      storageTransition: "PRIVATE_ASSET_V1"
    }
  });
  project = updated.project;
});

afterEach(async () => {
  resetRenderAssetTokensForTests();
  resetAssetStoreForTests();
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

function context(renderId = crypto.randomUUID()) {
  return {
    sessionId: SESSION_ID,
    assetBaseUrl: "http://127.0.0.1:3000",
    renderId
  };
}

describe("private Remotion render preparation", () => {
  it("maps aspect ratios to the required canvas sizes", () => {
    expect(getCompositionSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(getCompositionSize("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(getCompositionSize("1:1")).toEqual({ width: 1080, height: 1080 });
  });

  it("keeps the 40 second timeline and shot boundaries", () => {
    expect(sumShotDurations(coldBrewDemo.shots)).toBe(40);
    expect(getTimelineBoundaries(coldBrewDemo.shots).at(-1)?.endSec).toBe(40);
  });

  it("builds input props only from short-lived internal asset URLs", async () => {
    const prepared = await prepareRenderProject(project.id, { project }, context());
    expect(prepared.inputProps.durationInFrames).toBe(DEFAULT_DURATION_IN_FRAMES);
    expect(prepared.inputProps.heroShotId).toBe(project.heroShotId);
    expect(prepared.inputProps.heroVideoUrl).toContain("/api/internal/render-assets/");
    expect(prepared.inputProps.heroVideoUrl).toContain("token=");
    expect(prepared.inputProps.shots.every((shot) =>
      shot.keyframeUrl.includes("/api/internal/render-assets/")
    )).toBe(true);
    expect(prepared.inputProps.voiceoverUrl).toContain("/api/internal/render-assets/");
    expect(prepared.outputLocation.startsWith(storageRoot)).toBe(true);
    expect(prepared.outputLocation).not.toContain("public");

    const heroAssetId = project.heroVideo?.assetId;
    expect(heroAssetId).toBeTruthy();
    expect(resolveRenderAssetGrant(prepared.renderAssetToken, heroAssetId!)).not.toBeNull();
    revokeRenderAssetToken(prepared.renderAssetToken);
    expect(resolveRenderAssetGrant(prepared.renderAssetToken, heroAssetId!)).toBeNull();
  });

  it("blocks rendering when a keyframe asset ID is missing", async () => {
    const missing = {
      ...project,
      keyframes: project.keyframes?.filter((frame) => frame.shotId !== project.shots[1].id)
    };
    await expect(prepareRenderProject(project.id, { project: missing }, context()))
      .rejects.toMatchObject({ code: "KEYFRAME_MISSING" });
  });

  it("blocks rendering when the private hero video is missing", async () => {
    const missing = { ...project, heroVideo: undefined };
    await expect(prepareRenderProject(project.id, { project: missing }, context()))
      .rejects.toMatchObject({ code: "HERO_VIDEO_MISSING" });
  });

  it("uses the persisted dynamic duration while keeping explicit normalization available", async () => {
    const changed = {
      ...project,
      shots: project.shots.map((shot, index) =>
        index === 0 ? { ...shot, durationSec: 3 } : shot
      )
    };
    const prepared = await prepareRenderProject(project.id, { project: changed }, context());
    const preserved = normalizeShotDurations(changed.shots);
    const normalized = normalizeShotDurations(changed.shots, 40);
    expect(preserved).toHaveLength(8);
    expect(preserved.reduce((sum, seconds) => sum + seconds, 0)).toBe(38);
    expect(normalized.reduce((sum, seconds) => sum + seconds, 0)).toBe(40);
    expect(sumShotDurations(prepared.inputProps.shots)).toBe(38);
    expect(prepared.inputProps.durationInFrames).toBe(38 * 30);
    revokeRenderAssetToken(prepared.renderAssetToken);
  });

  it("rejects browser-only and placeholder render URLs", () => {
    expect(isForbiddenRenderUrl("blob:http://local")).toBe(true);
    expect(isForbiddenRenderUrl("/mock/final.mp4")).toBe(true);
    expect(isForbiddenRenderUrl("/landing-cold-brew-hero.png")).toBe(true);
    expect(isForbiddenRenderUrl("/api/projects/id/assets/id")).toBe(false);
  });

  it("keeps the legacy URL helper passive and does not invent public paths", () => {
    expect(resolveShotKeyframeUrl(project.id, project.shots[0])).toBe("");
  });

  it("does not allow another session to prepare the project assets", async () => {
    const foreignContext = { ...context(), sessionId: "render-private-session-b" };
    await expect(prepareRenderProject(project.id, { project }, foreignContext)).rejects.toThrow();
  });

  it("persists all asset IDs in the owned project", async () => {
    const restored = await requireOwnedAnonymousProject(SESSION_ID, project.id);
    expect(restored.project.keyframes?.every((frame) => Boolean(frame.assetId))).toBe(true);
    expect(restored.project.heroVideo?.assetId).toBeTruthy();
    expect(restored.project.narrationAssetId).toBeTruthy();
  });
});