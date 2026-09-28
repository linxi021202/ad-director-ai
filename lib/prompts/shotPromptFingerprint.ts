import { createHash } from "node:crypto";

import type { ShotPromptExpansionInput } from "./detailedDirectorPrompts";

export const SHOT_PROMPT_PACKAGE_SCHEMA_VERSION = 2 as const;

export function buildShotPromptInputFingerprint(input: ShotPromptExpansionInput): string {
  return createHash("sha256").update(stableStringify({
    schemaVersion: SHOT_PROMPT_PACKAGE_SCHEMA_VERSION,
    brief: input.brief,
    strategy: input.strategy,
    shot: promptSourceShot(input.shot),
    previousShot: input.previousShot ? promptSourceShot(input.previousShot) : null,
    productVisualSpec: input.productVisualSpec ?? null,
    visualContinuityBible: input.visualContinuityBible ?? null,
    referencePack: input.referencePack ?? null
  })).digest("hex");
}

export function matchesShotPromptInputFingerprint(fingerprint: string | undefined, input: ShotPromptExpansionInput): boolean {
  if (!fingerprint) return false;
  if (fingerprint === buildShotPromptInputFingerprint(input)) return true;
  // Project writes fill missing empty asset lists; this is not an upstream edit.
  const images = input.brief.productImages?.length ? [input.brief.productImages] : [undefined, []];
  const assets = input.brief.productAssetIds?.length ? [input.brief.productAssetIds] : [undefined, []];
  return images.some((productImages) => assets.some((productAssetIds) => fingerprint === buildShotPromptInputFingerprint({
    ...input, brief: { ...input.brief, productImages, productAssetIds }
  })));
}

function promptSourceShot(shot: ShotPromptExpansionInput["shot"]) {
  const {
    imagePromptCn: _imagePromptCn,
    imagePromptEn: _imagePromptEn,
    videoPromptCn: _videoPromptCn,
    videoPromptEn: _videoPromptEn,
    negativePromptCn: _negativePromptCn,
    negativePromptEn: _negativePromptEn,
    continuityConstraints: _continuityConstraints,
    primaryKeyframeAssetId: _primaryKeyframeAssetId,
    keyframeAssetId: _keyframeAssetId,
    frames,
    ...source
  } = shot;
  return {
    ...source,
    frames: frames?.map((frame) => {
      const {
        imagePromptCn: _frameImagePromptCn,
        imagePromptEn: _frameImagePromptEn,
        negativePromptCn: _frameNegativePromptCn,
        negativePromptEn: _frameNegativePromptEn,
        keyframeMoment: _keyframeMoment,
        assetId: _assetId,
        status: _status,
        isLocked: _isLocked,
        ...frameSource
      } = frame;
      // Retain the original pre-generation hash shape for saved checkpoints.
      return { ...frameSource, status: "pending", isLocked: false };
    })
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
