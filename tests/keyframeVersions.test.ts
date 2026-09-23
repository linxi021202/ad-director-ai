import { describe, expect, it } from "vitest";
import { archiveSupersededKeyframe, keepApprovedKeyframe } from "../lib/image/keyframeVersions";
import type { KeyframeMetadata } from "../lib/schemas/project";

const previous: KeyframeMetadata = {
  shotId: "shot-1", frameId: "frame-1", assetId: "11111111-1111-4111-8111-111111111111",
  status: "ready", fallbackUsed: false, storageTransition: "PRIVATE_ASSET_V1"
};

describe("keyframe regeneration versions", () => {
  it("keeps the last approved frame visible while replacement is generating or fails", () => {
    expect(keepApprovedKeyframe(previous, "generated")).toBe(true);
    expect(keepApprovedKeyframe(previous, "needs-review")).toBe(true);
    expect(keepApprovedKeyframe(previous, "fallback")).toBe(true);
    expect(keepApprovedKeyframe(previous, "ready")).toBe(false);
  });

  it("archives the old private asset only after a different replacement is approved", () => {
    expect(archiveSupersededKeyframe([], previous, "22222222-2222-4222-8222-222222222222", "failed")).toEqual([]);
    expect(archiveSupersededKeyframe([], previous, previous.assetId, "ready")).toEqual([]);
    expect(archiveSupersededKeyframe([], previous, "22222222-2222-4222-8222-222222222222", "ready")).toEqual([previous]);
  });
});
