import { randomUUID } from "node:crypto";
import { z } from "zod";

import { shotContainsProduct } from "../continuity/projectContinuity";
import { readPrivateVisualAssetDataUrl } from "../image/productReference";
import {
  keyframeQAResultSchema,
  videoQAResultSchema,
  type GenerationProject,
  type KeyframeQAResult,
  type StoryboardShot,
  type VideoQAResult
} from "../schemas/project";
import { callVisualInspector } from "./visualInspector";
import { serializeProductVisualSpecForPrompt } from "./productVisualSpec";

const keyframeInspectorSchema = z.object({
  singleFramePassed: z.boolean(),
  singleFullFramePassed: z.boolean(),
  panelCount: z.number().int().min(1),
  collageDetected: z.boolean(),
  productMatchPassed: z.boolean(),
  containerTypeMatch: z.boolean(),
  silhouetteMatch: z.boolean(),
  lidTypeMatch: z.boolean(),
  majorGeometryMatch: z.boolean(),
  dominantColorMatch: z.boolean(),
  characterMatchPassed: z.boolean(),
  sceneMatchPassed: z.boolean(),
  textSafetyPassed: z.boolean(),
  generatedTextDetected: z.boolean(),
  sourceProductTextPreserved: z.boolean(),
  issues: z.array(z.string().min(1)).max(30),
  repairPrompt: z.string().min(1).optional()
}).strict();

const videoInspectorSchema = z.object({
  singleContinuousShotPassed: z.boolean(),
  temporalConsistencyPassed: z.boolean(),
  productMatchPassed: z.boolean(),
  containerTypeMatch: z.boolean(),
  silhouetteMatch: z.boolean(),
  lidTypeMatch: z.boolean(),
  majorGeometryMatch: z.boolean(),
  dominantColorMatch: z.boolean(),
  characterMatchPassed: z.boolean(),
  sceneMatchPassed: z.boolean(),
  textSafetyPassed: z.boolean(),
  generatedTextDetected: z.boolean(),
  sourceProductTextPreserved: z.boolean(),
  issues: z.array(z.string().min(1)).max(30),
  repairPrompt: z.string().min(1).optional()
}).strict();

export async function inspectKeyframe(input: {
  sessionId: string;
  project: GenerationProject;
  shot: StoryboardShot;
  frameId?: string;
  candidateAssetId: string;
  productAssetId?: string;
  masterAssetIds?: string[];
  attempt: 1 | 2;
  generationEventId?: string;
}): Promise<KeyframeQAResult> {
  const ids = unique([
    input.candidateAssetId,
    ...(input.productAssetId ? [input.productAssetId] : []),
    ...(input.masterAssetIds ?? [])
  ]);
  const images = await Promise.all(ids.map((assetId) => readPrivateVisualAssetDataUrl(assetId, {
    sessionId: input.sessionId,
    projectId: input.project.id
  })));
  const result = await callVisualInspector({
    sessionId: input.sessionId,
    images,
    schema: keyframeInspectorSchema,
    prompt: `Inspect image 1 as the generated candidate. ${input.productAssetId ? "Image 2 is the authoritative Product Master." : "This shot contains no product."} Remaining images are locked Character/Scene Masters when present.
Shot intent: ${input.shot.visualDescription}
${shotContainsProduct(input.shot) ? serializeProductVisualSpecForPrompt(input.project.productVisualSpec) : "This shot intentionally contains no product."}
Return exactly: singleFramePassed, singleFullFramePassed, panelCount, collageDetected, productMatchPassed, containerTypeMatch, silhouetteMatch, lidTypeMatch, majorGeometryMatch, dominantColorMatch, characterMatchPassed, sceneMatchPassed, textSafetyPassed, generatedTextDetected, sourceProductTextPreserved, issues, repairPrompt.
Treat the Product Master pixel region as sourceProductRegion. Original logo and packaging text inside sourceProductRegion are allowed only when those pixels are preserved from the source. Every other pixel is generatedRegion. Any readable characters, numbers, logo-like lettering, screen text, signs, labels, prices, watermark or pseudo-text in generatedRegion is TEXT_CONTAMINATION_FAILURE: generatedTextDetected=true and textSafetyPassed=false.
Hard failures: collage, split screen, contact sheet, storyboard, grid, multi-panel layout, before/after layout, or multiple moments on one canvas; wrong product container type, silhouette, lid type, major geometry, dominant colors, label layout, or logo position; changed character identity/wardrobe; changed locked scene architecture/props/lighting; generated text contamination.
For a cup Product Master, bottle/can/carton output is an unconditional product failure. A flat lid becoming a screw cap, or a short cup becoming a tall narrow container, is an unconditional product failure.
Set productMatchPassed=true when the shot intentionally contains no product. Set characterMatchPassed=true when no character is required. Set sceneMatchPassed=true only when the candidate follows the specified scene. repairPrompt must be a concise correction for this same single frame, never a request for additional panels.`
  });
  if (!result.success || !result.data) {
    return keyframeQAResultSchema.parse({
      id: randomUUID(), shotId: input.shot.id, frameId: input.frameId, assetId: input.candidateAssetId, attempt: input.attempt,
      ...(input.generationEventId ? { generationEventId: input.generationEventId } : {}),
      inspectorModel: result.model, checkedAt: new Date().toISOString(), singleFramePassed: false,
      singleFullFramePassed: false, panelCount: 2, collageDetected: true,
      productMatchPassed: false, characterMatchPassed: false, sceneMatchPassed: false, textSafetyPassed: false,
      containerTypeMatch: false, silhouetteMatch: false, lidTypeMatch: false, majorGeometryMatch: false, dominantColorMatch: false,
      generatedTextDetected: true, sourceProductTextPreserved: false,
      overallPassed: false, issues: [result.error ?? "VISUAL_QA_UNAVAILABLE"],
      repairPrompt: "重新生成同一镜头的一张完整单帧画面，并严格匹配全部 Master References。"
    });
  }
  return finalizeKeyframeQA({
    ...result.data,
    id: randomUUID(), shotId: input.shot.id, frameId: input.frameId, assetId: input.candidateAssetId, attempt: input.attempt,
    ...(input.generationEventId ? { generationEventId: input.generationEventId } : {}),
    inspectorModel: result.model, checkedAt: new Date().toISOString()
  });
}

export async function inspectVideo(input: {
  sessionId: string;
  project: GenerationProject;
  shot: StoryboardShot;
  videoUrl: string;
  productAssetId?: string;
  masterAssetIds?: string[];
  attempt: 1 | 2;
  generationEventId?: string;
}): Promise<VideoQAResult> {
  const supportIds = unique([
    ...(input.productAssetId ? [input.productAssetId] : []),
    ...(input.masterAssetIds ?? [])
  ]);
  const images = await Promise.all(supportIds.map((assetId) => readPrivateVisualAssetDataUrl(assetId, {
    sessionId: input.sessionId,
    projectId: input.project.id
  })));
  const result = await callVisualInspector({
    sessionId: input.sessionId,
    images,
    videoUrl: input.videoUrl,
    schema: videoInspectorSchema,
    prompt: `Inspect the generated video against this shot: ${input.shot.visualDescription}. Supporting images are Product, Character, and Scene Masters in that order when present.
${serializeProductVisualSpecForPrompt(input.project.productVisualSpec)}
Return exactly: singleContinuousShotPassed, temporalConsistencyPassed, productMatchPassed, containerTypeMatch, silhouetteMatch, lidTypeMatch, majorGeometryMatch, dominantColorMatch, characterMatchPassed, sceneMatchPassed, textSafetyPassed, generatedTextDetected, sourceProductTextPreserved, issues, repairPrompt.
Treat text inside unchanged source Product Master pixels as allowed. Any readable or pseudo text elsewhere is TEXT_CONTAMINATION_FAILURE. Product morphing, silhouette drift, container-type change, lid mutation, major geometry change, dominant-color change or label mutation are hard failures.
Hard failures: any cut, split screen, collage, montage, grid, multi-panel layout or multiple simultaneous moments; product identity drift; character identity or wardrobe drift; scene architecture/prop/lighting drift; temporal melting, duplication or abrupt geometry changes; generated text contamination.`
  });
  if (!result.success || !result.data) {
    return videoQAResultSchema.parse({
      id: randomUUID(), shotId: input.shot.id, attempt: input.attempt, inspectorModel: result.model,
      ...(input.generationEventId ? { generationEventId: input.generationEventId } : {}),
      checkedAt: new Date().toISOString(), singleContinuousShotPassed: false, temporalConsistencyPassed: false,
      productMatchPassed: false, characterMatchPassed: false, sceneMatchPassed: false, textSafetyPassed: false,
      containerTypeMatch: false, silhouetteMatch: false, lidTypeMatch: false, majorGeometryMatch: false, dominantColorMatch: false,
      generatedTextDetected: true, sourceProductTextPreserved: false,
      overallPassed: false, issues: [result.error ?? "VIDEO_QA_UNAVAILABLE"],
      repairPrompt: "重新生成一个连续全画幅单镜头视频，只保留一个主体动作和一次连续运镜。"
    });
  }
  return finalizeVideoQA({
    ...result.data,
    id: randomUUID(), shotId: input.shot.id, attempt: input.attempt,
    ...(input.generationEventId ? { generationEventId: input.generationEventId } : {}),
    inspectorModel: result.model, checkedAt: new Date().toISOString()
  });
}

export function finalizeKeyframeQA(input: Omit<KeyframeQAResult, "overallPassed">): KeyframeQAResult {
  const overallPassed = input.singleFramePassed && (input.singleFullFramePassed ?? input.singleFramePassed) && (input.panelCount ?? 1) === 1 && !input.collageDetected
    && input.productMatchPassed && input.containerTypeMatch !== false
    && input.silhouetteMatch !== false && input.lidTypeMatch !== false && input.majorGeometryMatch !== false && input.dominantColorMatch !== false
    && input.characterMatchPassed && input.sceneMatchPassed && input.textSafetyPassed
    && input.generatedTextDetected !== true && input.sourceProductTextPreserved !== false;
  return keyframeQAResultSchema.parse({ ...input, overallPassed, issues: normalizeHardFailureIssues(input) });
}

export function finalizeVideoQA(input: Omit<VideoQAResult, "overallPassed">): VideoQAResult {
  const overallPassed = input.singleContinuousShotPassed && input.temporalConsistencyPassed
    && input.productMatchPassed && input.containerTypeMatch !== false && input.silhouetteMatch !== false && input.lidTypeMatch !== false
    && input.majorGeometryMatch !== false && input.dominantColorMatch !== false && input.characterMatchPassed
    && input.sceneMatchPassed && input.textSafetyPassed && input.generatedTextDetected !== true && input.sourceProductTextPreserved !== false;
  return videoQAResultSchema.parse({ ...input, overallPassed, issues: normalizeHardFailureIssues(input) });
}

export function createMockKeyframeQA(shot: StoryboardShot, attempt: 1 | 2 = 1, frameId?: string): KeyframeQAResult {
  return keyframeQAResultSchema.parse({
    id: randomUUID(), shotId: shot.id, frameId, attempt, inspectorModel: "mock-visual-qa", checkedAt: new Date().toISOString(),
    singleFramePassed: true, singleFullFramePassed: true, panelCount: 1, collageDetected: false,
    productMatchPassed: true, characterMatchPassed: true, sceneMatchPassed: true,
    containerTypeMatch: true, silhouetteMatch: true, lidTypeMatch: true, majorGeometryMatch: true, dominantColorMatch: true,
    textSafetyPassed: true, generatedTextDetected: false, sourceProductTextPreserved: true, overallPassed: true, issues: []
  });
}

export function shotNeedsProductQA(shot: StoryboardShot) {
  return shotContainsProduct(shot);
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function normalizeHardFailureIssues(input: Pick<KeyframeQAResult, "issues" | "generatedTextDetected" | "containerTypeMatch" | "silhouetteMatch" | "lidTypeMatch" | "majorGeometryMatch" | "dominantColorMatch" | "singleFullFramePassed" | "panelCount" | "collageDetected">) {
  return unique([
    ...input.issues,
    ...(input.generatedTextDetected ? ["TEXT_CONTAMINATION_FAILURE"] : []),
    ...(input.containerTypeMatch === false ? ["PRODUCT_CONTAINER_TYPE_FAILURE"] : []),
    ...(input.silhouetteMatch === false ? ["PRODUCT_SILHOUETTE_FAILURE"] : []),
    ...(input.lidTypeMatch === false ? ["PRODUCT_LID_TYPE_FAILURE"] : []),
    ...(input.majorGeometryMatch === false ? ["PRODUCT_MAJOR_GEOMETRY_FAILURE"] : []),
    ...(input.dominantColorMatch === false ? ["PRODUCT_DOMINANT_COLOR_FAILURE"] : []),
    ...(input.singleFullFramePassed === false || (input.panelCount ?? 1) > 1 || input.collageDetected ? ["MULTI_PANEL_OR_COLLAGE_FAILURE"] : [])
  ]);
}
