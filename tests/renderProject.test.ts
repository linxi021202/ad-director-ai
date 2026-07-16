import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
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

const PROJECT_ID = "render-test-project";
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lX4xQwAAAABJRU5ErkJggg==",
  "base64"
);
const MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32
]);

describe("Remotion render project preparation", () => {
  beforeEach(async () => {
    await createRenderAssets();
  });

  afterEach(async () => {
    await rm(path.join(process.cwd(), "public", "generated", PROJECT_ID), { recursive: true, force: true });
    await rm(path.join(process.cwd(), "data", "projects", `${PROJECT_ID}.json`), { force: true });
    await rm(path.join(process.cwd(), "data", "projects", `${PROJECT_ID}.render.json`), { force: true });
  });

  it("maps aspect ratios to the required Remotion canvas sizes", () => {
    expect(getCompositionSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(getCompositionSize("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(getCompositionSize("1:1")).toEqual({ width: 1080, height: 1080 });
  });

  it("keeps the 28 second timeline and fixed shot boundaries", () => {
    expect(sumShotDurations(coldBrewDemo.shots)).toBe(28);
    expect(getTimelineBoundaries(coldBrewDemo.shots)).toEqual([
      { id: coldBrewDemo.shots[0].id, startSec: 0, endSec: 6, durationSec: 6 },
      { id: coldBrewDemo.shots[1].id, startSec: 6, endSec: 13, durationSec: 7 },
      { id: coldBrewDemo.shots[2].id, startSec: 13, endSec: 20, durationSec: 7 },
      { id: coldBrewDemo.shots[3].id, startSec: 20, endSec: 28, durationSec: 8 }
    ]);
  });

  it("builds valid inputProps and places the hero video in shot 3", async () => {
    const project = renderProject();
    const prepared = await prepareRenderProject(PROJECT_ID, {
      project,
      keyframes: keyframeManifest(project)
    });

    expect(prepared.inputProps.durationInFrames).toBe(DEFAULT_DURATION_IN_FRAMES);
    expect(prepared.inputProps.heroShotId).toBe(project.shots[2].id);
    expect(prepared.inputProps.heroVideoUrl).toBe(`/generated/${PROJECT_ID}/video/hero-shot.mp4`);
    expect(prepared.inputProps.shots[2].id).toBe(project.shots[2].id);
    expect(prepared.outputUrl).toBe(`/generated/${PROJECT_ID}/final/ad-final.mp4`);
  });

  it("rejects remote, blob, mock and placeholder URLs", () => {
    expect(isForbiddenRenderUrl("https://example.com/temp.png")).toBe(true);
    expect(isForbiddenRenderUrl("blob:http://local")).toBe(true);
    expect(isForbiddenRenderUrl("/mock/final.mp4")).toBe(true);
    expect(isForbiddenRenderUrl("/landing-cold-brew-hero.png")).toBe(true);
    expect(isForbiddenRenderUrl(`/generated/images/${PROJECT_ID}/shot-1.png`)).toBe(false);
  });

  it("blocks rendering when a keyframe is missing", async () => {
    await rm(path.join(process.cwd(), "public", "generated", "images", PROJECT_ID, "shot-2.png"), { force: true });
    await expect(prepareRenderProject(PROJECT_ID, {
      project: renderProject(),
      keyframes: keyframeManifest(renderProject())
    })).rejects.toMatchObject({ code: "KEYFRAME_MISSING" });
  });

  it("blocks rendering when the hero video is missing", async () => {
    await rm(path.join(process.cwd(), "public", "generated", PROJECT_ID, "video", "hero-shot.mp4"), { force: true });
    await expect(prepareRenderProject(PROJECT_ID, {
      project: renderProject(),
      keyframes: keyframeManifest(renderProject())
    })).rejects.toMatchObject({ code: "HERO_VIDEO_MISSING" });
  });

  it("normalizes arbitrary shot durations to a 28 second composition", async () => {
    const project = renderProject({ shots: coldBrewDemo.shots.map((shot, index) => index === 0 ? { ...shot, durationSec: 3 } : shot) });
    const prepared = await prepareRenderProject(PROJECT_ID, {
      project,
      keyframes: keyframeManifest(project)
    });

    expect(normalizeShotDurations(project.shots)).toHaveLength(4);
    expect(sumShotDurations(prepared.inputProps.shots)).toBe(28);
    expect(prepared.inputProps.shots.every((shot) => shot.durationSec > 0)).toBe(true);
  });

  it("passes a persisted narration asset and generated keywords to Remotion", async () => {
    const project = renderProject();
    const prepared = await prepareRenderProject(PROJECT_ID, {
      project,
      keyframes: keyframeManifest(project),
      voiceoverUrl: `/generated/${PROJECT_ID}/audio/voiceover.mp3`
    });

    expect(prepared.inputProps.voiceoverUrl).toBe(`/generated/${PROJECT_ID}/audio/voiceover.mp3`);
    expect(prepared.inputProps.shots.some((shot) => shot.keywords.length > 0)).toBe(true);
  });

  it("falls back to stable local keyframe paths when the manifest is absent", () => {
    expect(resolveShotKeyframeUrl(PROJECT_ID, coldBrewDemo.shots[0])).toBe(`/generated/images/${PROJECT_ID}/shot-1.png`);
  });
});

async function createRenderAssets() {
  const imageDir = path.join(process.cwd(), "public", "generated", "images", PROJECT_ID);
  const videoDir = path.join(process.cwd(), "public", "generated", PROJECT_ID, "video");
  const audioDir = path.join(process.cwd(), "public", "generated", PROJECT_ID, "audio");
  const dataDir = path.join(process.cwd(), "data", "projects");
  await mkdir(imageDir, { recursive: true });
  await mkdir(videoDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  for (let index = 1; index <= 4; index += 1) {
    await writeFile(path.join(imageDir, `shot-${index}.png`), PNG_BYTES);
  }
  await writeFile(path.join(videoDir, "hero-shot.mp4"), MP4_BYTES);
  await writeFile(path.join(audioDir, "voiceover.mp3"), Buffer.from([0x49, 0x44, 0x33, 0x04]));
  await writeFile(path.join(dataDir, `${PROJECT_ID}.json`), JSON.stringify({
    projectId: PROJECT_ID,
    heroShotId: coldBrewDemo.shots[2].id,
    heroVideoAsset: {
      id: `${PROJECT_ID}-hero`,
      projectId: PROJECT_ID,
      shotId: coldBrewDemo.shots[2].id,
      source: "happyhorse-manual-import",
      fileName: "hero-shot.mp4",
      mimeType: "video/mp4",
      sizeBytes: MP4_BYTES.length,
      durationSec: 4,
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      localPath: `public/generated/${PROJECT_ID}/video/hero-shot.mp4`,
      publicUrl: `/generated/${PROJECT_ID}/video/hero-shot.mp4`,
      createdAt: new Date().toISOString()
    },
    updatedAt: new Date().toISOString()
  }), "utf8");
}

function renderProject(patch: Partial<GenerationProject> = {}): GenerationProject {
  return {
    ...coldBrewDemo,
    ...patch,
    id: PROJECT_ID,
    heroShotId: coldBrewDemo.shots[2].id,
    brief: {
      ...coldBrewDemo.brief,
      ...(patch.brief ?? {})
    }
  };
}

function keyframeManifest(project: GenerationProject) {
  return Object.fromEntries(project.shots.map((shot) => [shot.id, {
    shotId: shot.id,
    localUrl: `/generated/images/${PROJECT_ID}/shot-${shot.index}.png`,
    status: "ready"
  }]));
}


