vi.mock("server-only", () => ({}));

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteHeroVideoAsset,
  heroShotWorkflowStatusLabel,
  heroVideoFileExists,
  readHeroVideoProjectState,
  safeSegment,
  saveHeroVideoAsset
} from "../lib/heroVideoAsset";
import {
  createAnonymousProject,
  resetAnonymousProjectQueuesForTests
} from "../lib/projects/anonymousProjectStore";

const SESSION_A = "hero-video-session-a";
let storageRoot = "";
let projectId = "";
let heroShotId = "";
let heroShotDurationSec = 5;
const originalEnv = { ...process.env };

function atom(type: string, payload: Buffer) {
  const output = Buffer.alloc(payload.length + 8);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, "ascii");
  payload.copy(output, 8);
  return output;
}

function fakeMp4(input: { durationSec: number; width: number; height: number }) {
  const ftyp = atom("ftyp", Buffer.from([
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x01,
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32
  ]));
  const mvhdPayload = Buffer.alloc(100);
  mvhdPayload.writeUInt8(0, 0);
  mvhdPayload.writeUInt32BE(1000, 12);
  mvhdPayload.writeUInt32BE(Math.round(input.durationSec * 1000), 16);
  const tkhdPayload = Buffer.alloc(100);
  tkhdPayload.writeUInt8(0, 0);
  tkhdPayload.writeUInt32BE(input.width * 65536, 76);
  tkhdPayload.writeUInt32BE(input.height * 65536, 80);
  return Buffer.concat([
    ftyp,
    atom("moov", Buffer.concat([
      atom("mvhd", mvhdPayload),
      atom("trak", atom("tkhd", tkhdPayload))
    ]))
  ]);
}

async function save(input: {
  durationSec?: number;
  width?: number;
  height?: number;
  source?: "happyhorse-manual-import" | "happyhorse-api";
  fileName?: string;
  mimeType?: string;
}) {
  const buffer = fakeMp4({
    durationSec: input.durationSec ?? heroShotDurationSec,
    width: input.width ?? 720,
    height: input.height ?? 1280
  });
  return saveHeroVideoAsset({
    sessionId: SESSION_A,
    projectId,
    shotId: heroShotId,
    aspectRatio: "9:16",
    fileName: input.fileName ?? "hero-shot.mp4",
    mimeType: input.mimeType ?? "video/mp4",
    sizeBytes: buffer.length,
    buffer,
    source: input.source
  });
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-hero-video-"));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "hero-video-test-salt";
  resetAnonymousProjectQueuesForTests();
  const created = await createAnonymousProject(SESSION_A, { templateId: "cold-brew-demo" });
  projectId = created.id;
  const heroShot = created.project.shots.find((shot) => shot.id === created.project.heroShotId) ?? created.project.shots[0]!;
  heroShotId = heroShot.id;
  heroShotDurationSec = heroShot.durationSec;
});

afterEach(async () => {
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("private HappyHorse hero video assets", () => {
  it("stores and restores a valid MP4 through the authorized asset URL", async () => {
    const result = await save({});
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.asset.publicUrl).toBe(
      `/api/projects/${projectId}/assets/${result.asset.assetId}`
    );
    expect(result.asset.source).toBe("happyhorse-manual-import");
    expect(await heroVideoFileExists(SESSION_A, result.asset)).toBe(true);

    const state = await readHeroVideoProjectState(SESSION_A, projectId);
    expect(state.heroShotId).toBe(heroShotId);
    expect(state.heroVideoAsset?.assetId).toBe(result.asset.assetId);
  });

  it("rejects non-MP4 uploads before creating an asset", async () => {
    const result = await save({ fileName: "hero.mov", mimeType: "video/quicktime" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(400);
  });

  it("accepts complete manual-import videos without duration or aspect restrictions", async () => {
    const short = await save({ durationSec: 2 });
    expect(short.success).toBe(true);

    const horizontal = await save({ width: 1280, height: 720 });
    expect(horizontal.success).toBe(true);
  });

  it("keeps HappyHorse API output constrained to the selected shot duration", async () => {
    const short = await save({ durationSec: 2, source: "happyhorse-api" });
    expect(short.success).toBe(false);

    const mismatch = await save({ durationSec: heroShotDurationSec + 2, source: "happyhorse-api" });
    expect(mismatch.success).toBe(false);
  });

  it("accepts an API video for Remotion adaptation and records its source", async () => {
    const result = await save({
      width: 1280,
      height: 720,
      source: "happyhorse-api"
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.asset.source).toBe("happyhorse-api");
  });

  it("keeps the previous valid video when replacement validation fails", async () => {
    const first = await save({});
    expect(first.success).toBe(true);
    const failed = await save({ fileName: "replacement.mov", mimeType: "video/quicktime" });
    expect(failed.success).toBe(false);

    const state = await readHeroVideoProjectState(SESSION_A, projectId);
    expect(state.heroVideoAsset?.durationSec).toBe(heroShotDurationSec);
  });

  it("deletes the private video and returns to the waiting state", async () => {
    expect((await save({})).success).toBe(true);
    await deleteHeroVideoAsset(SESSION_A, projectId);
    const state = await readHeroVideoProjectState(SESSION_A, projectId);
    expect(state.heroVideoAsset).toBeNull();
    expect(heroShotWorkflowStatusLabel("waiting-manual-import")).toBe("等待导入视频");
  });

  it("does not allow another session to read the asset", async () => {
    expect((await save({})).success).toBe(true);
    await expect(readHeroVideoProjectState("hero-video-session-b", projectId)).rejects.toThrow();
  });

  it("sanitizes path segments", () => {
    expect(safeSegment("../bad/project", "project")).toBe("bad-project");
  });
});
