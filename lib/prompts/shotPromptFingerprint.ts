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

function promptSourceShot(shot: ShotPromptExpansionInput["shot"]) {
  const {
    imagePromptCn: _imagePromptCn,
    imagePromptEn: _imagePromptEn,
    videoPromptCn: _videoPromptCn,
    videoPromptEn: _videoPromptEn,
    negativePromptCn: _negativePromptCn,
    negativePromptEn: _negativePromptEn,
    continuityConstraints: _continuityConstraints,
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
        ...frameSource
      } = frame;
      return frameSource;
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
