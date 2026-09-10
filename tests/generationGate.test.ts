import { describe, expect, it } from "vitest";

import { hasApprovedKeyframeQA, hasApprovedVideoQA } from "../lib/visual/generationGate";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import type { GenerationProject } from "../lib/schemas/project";

const frameAssetId = "66666666-6666-4666-8666-666666666666";
const videoAssetId = "77777777-7777-4777-8777-777777777777";
const qaId = "88888888-8888-4888-8888-888888888888";
const shotId = coldBrewDemo.shots[0].id;

function project(): GenerationProject {
  return {
    ...coldBrewDemo,
    keyframes: [{
      shotId, assetId: frameAssetId, fallbackUsed: false, status: "ready", storageTransition: "PRIVATE_ASSET_V1"
    }],
    keyframeQAResults: [{
      id: qaId, shotId, assetId: frameAssetId, attempt: 1, inspectorModel: "qwen3.7-plus",
      checkedAt: "2026-09-06T12:00:00.000Z", singleFramePassed: true, productMatchPassed: true,
      characterMatchPassed: true, sceneMatchPassed: true, textSafetyPassed: true, overallPassed: true, issues: []
    }]
  } as GenerationProject;
}

describe("generation QA gates", () => {
  it("allows video generation only from a ready QA-passed keyframe", () => {
    expect(hasApprovedKeyframeQA(project(), shotId)).toBe(true);
  });

  it("blocks a generated keyframe while QA is missing", () => {
    expect(hasApprovedKeyframeQA({ ...project(), keyframeQAResults: [] }, shotId)).toBe(false);
  });

  it("blocks needs-review keyframes even when an older QA result passed", () => {
    const value = project();
    value.keyframes![0]!.status = "needs-review";
    expect(hasApprovedKeyframeQA(value, shotId)).toBe(false);
  });

  it("allows a generated video only after video QA passes", () => {
    const value = {
      ...project(),
      heroVideo: { shotId, assetId: videoAssetId, source: "wan-api", status: "ready", storageTransition: "PRIVATE_ASSET_V1" as const },
      videoQAResults: [{
        id: qaId, shotId, attempt: 1, inspectorModel: "qwen3.7-plus", checkedAt: "2026-09-06T12:00:00.000Z",
        singleContinuousShotPassed: true, temporalConsistencyPassed: true, productMatchPassed: true,
        characterMatchPassed: true, sceneMatchPassed: true, textSafetyPassed: true, overallPassed: true, issues: []
      }]
    };
    expect(hasApprovedVideoQA(value, shotId)).toBe(true);
  });

  it("blocks a generated video whose QA result failed", () => {
    const value = {
      ...project(),
      heroVideo: { shotId, assetId: videoAssetId, source: "wan-api", status: "ready", storageTransition: "PRIVATE_ASSET_V1" as const },
      videoQAResults: []
    };
    expect(hasApprovedVideoQA(value, shotId)).toBe(false);
  });

  it("keeps explicit user-upload video compatibility", () => {
    const value = {
      ...project(),
      heroVideo: { shotId, assetId: videoAssetId, source: "user-upload", status: "ready", storageTransition: "PRIVATE_ASSET_V1" as const }
    };
    expect(hasApprovedVideoQA(value, shotId)).toBe(true);
  });
});
