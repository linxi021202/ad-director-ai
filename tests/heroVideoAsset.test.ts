import { describe, expect, it } from "vitest";
import {
  deleteHeroVideoAsset,
  heroShotWorkflowStatusLabel,
  heroVideoFileExists,
  readHeroVideoProjectState,
  safeSegment,
  saveHeroVideoAsset
} from "../lib/heroVideoAsset";

function atom(type: string, payload: Buffer) {
  const output = Buffer.alloc(payload.length + 8);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, "ascii");
  payload.copy(output, 8);
  return output;
}

function ftyp() {
  return atom("ftyp", Buffer.from([0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x01, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]));
}

function mvhd(durationSec: number, timescale = 1000) {
  const payload = Buffer.alloc(100);
  payload.writeUInt8(0, 0);
  payload.writeUInt32BE(timescale, 12);
  payload.writeUInt32BE(Math.round(durationSec * timescale), 16);
  return atom("mvhd", payload);
}

function tkhd(width: number, height: number) {
  const payload = Buffer.alloc(100);
  payload.writeUInt8(0, 0);
  payload.writeUInt32BE(width * 65536, 76);
  payload.writeUInt32BE(height * 65536, 80);
  return atom("tkhd", payload);
}

function fakeMp4(input: { durationSec: number; width: number; height: number }) {
  return Buffer.concat([ftyp(), atom("moov", Buffer.concat([mvhd(input.durationSec), atom("trak", tkhd(input.width, input.height))]))]);
}

describe("HappyHorse manual hero video assets", () => {
  it("saves a valid 9:16 MP4 and restores it from local project state", async () => {
    const projectId = `vitest-hero-${Date.now()}`;
    const result = await saveHeroVideoAsset({
      projectId,
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      buffer: fakeMp4({ durationSec: 4, width: 720, height: 1280 })
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.asset.publicUrl).toBe(`/generated/${projectId}/video/hero-shot.mp4`);
      expect(result.asset.source).toBe("happyhorse-manual-import");
      expect(await heroVideoFileExists(result.asset)).toBe(true);
    }

    const state = await readHeroVideoProjectState(projectId);
    expect(state.heroShotId).toBe("shot-3");
    expect(state.heroVideoAsset?.publicUrl).toBe(`/generated/${projectId}/video/hero-shot.mp4`);
  });

  it("rejects non-MP4 uploads", async () => {
    const result = await saveHeroVideoAsset({
      projectId: "vitest-non-mp4",
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "hero.mov",
      mimeType: "video/quicktime",
      sizeBytes: 1024,
      buffer: fakeMp4({ durationSec: 4, width: 720, height: 1280 })
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("mp4");
  });

  it("rejects files over 50MB before writing", async () => {
    const result = await saveHeroVideoAsset({
      projectId: "vitest-too-large",
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: 51 * 1024 * 1024,
      buffer: fakeMp4({ durationSec: 4, width: 720, height: 1280 })
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("50MB");
  });

  it("rejects videos shorter than 3 seconds", async () => {
    const result = await saveHeroVideoAsset({
      projectId: "vitest-too-short",
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      buffer: fakeMp4({ durationSec: 2, width: 720, height: 1280 })
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("短于 3 秒");
  });

  it("rejects videos longer than 8 seconds", async () => {
    const result = await saveHeroVideoAsset({
      projectId: "vitest-too-long",
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      buffer: fakeMp4({ durationSec: 9, width: 720, height: 1280 })
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("不能超过 8 秒");
  });

  it("rejects videos whose direction does not match the project aspect ratio", async () => {
    const result = await saveHeroVideoAsset({
      projectId: "vitest-aspect-mismatch",
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      buffer: fakeMp4({ durationSec: 4, width: 1280, height: 720 })
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("上传视频画幅与当前项目设置不一致。");
  });

  it("accepts HappyHorse API videos with a different direction for Remotion adaptation", async () => {
    const result = await saveHeroVideoAsset({
      projectId: `vitest-api-aspect-${Date.now()}`,
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "happyhorse-hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      buffer: fakeMp4({ durationSec: 4, width: 1280, height: 720 }),
      source: "happyhorse-api"
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.asset.source).toBe("happyhorse-api");
      expect(result.asset.width).toBe(1280);
      expect(result.asset.height).toBe(720);
      expect(result.asset.aspectRatio).toBe("9:16");
    }
  });

  it("keeps the old video when replacement validation fails", async () => {
    const projectId = `vitest-replace-${Date.now()}`;
    const first = await saveHeroVideoAsset({
      projectId,
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      buffer: fakeMp4({ durationSec: 4, width: 720, height: 1280 })
    });
    expect(first.success).toBe(true);

    const failed = await saveHeroVideoAsset({
      projectId,
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      buffer: fakeMp4({ durationSec: 2, width: 720, height: 1280 })
    });
    expect(failed.success).toBe(false);

    const state = await readHeroVideoProjectState(projectId);
    expect(state.heroVideoAsset?.durationSec).toBe(4);
    expect(await heroVideoFileExists(state.heroVideoAsset)).toBe(true);
  });

  it("deletes video and returns workflow state to waiting manual import", async () => {
    const projectId = `vitest-delete-${Date.now()}`;
    const result = await saveHeroVideoAsset({
      projectId,
      shotId: "shot-3",
      aspectRatio: "9:16",
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      buffer: fakeMp4({ durationSec: 4, width: 720, height: 1280 })
    });
    expect(result.success).toBe(true);

    await deleteHeroVideoAsset(projectId);
    const state = await readHeroVideoProjectState(projectId);
    expect(state.heroVideoAsset).toBeNull();
    expect(heroShotWorkflowStatusLabel("waiting-manual-import")).toBe("等待导入视频");
  });

  it("sanitizes project and shot path segments", () => {
    expect(safeSegment("../bad/project", "project")).toBe("bad-project");
    expect(safeSegment("shot-3", "shot")).toBe("shot-3");
  });
});

