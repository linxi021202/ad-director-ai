import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { coldBrewDemo } from "@/lib/mock/coldBrewDemo";
import { ensureProjectContinuity } from "@/lib/continuity/projectContinuity";
import { buildPartialNarrationPlan } from "@/lib/audio/narrationPlan";
import { ensureStoryboardArchitecture } from "@/lib/storyboard/shotArchitecture";
import {
  adStrategySchema,
  aspectRatioSchema,
  assetSchema,
  finalVideoMetadataSchema,
  creativeBibleSchema,
  creativeWorkspaceSchema,
  generationEventSchema,
  generationProjectSchema,
  generationStatusSchema,
  heroVideoMetadataSchema,
  keyframeMetadataSchema,
  keyframeQAResultSchema,
  narrationPlanSchema,
  platformSchema,
  productBriefSchema,
  productVisualSpecSchema,
  projectPromptSchema,
  referencePackSchema,
  characterVisualSpecSchema,
  sceneVisualSpecSchema,
  visualAnchorWorkspaceSchema,
  stageIdSchema,
  stageStatesSchema,
  storyboardShotSchema,
  dependencyNodeSchema,
  detailedShotPromptPackageSchema,
  versionedResourceSchema,
  videoQAResultSchema,
  visualContinuityBibleSchema,
  workflowStepsSchema,
  type GenerationProject,
  type StageId,
  type StoryboardShot,
  type VersionedResourceType,
  type WorkflowSteps
} from "@/lib/schemas/project";
import { assertStoryboardMatchesPlanning, planningConstraintsFromBrief, resolveProjectPlanningConstraints } from "@/lib/projects/planningConstraints";
import { ensureVisualAnchorWorkspace } from "@/lib/visual/visualAnchors";
import { deriveVisualSetupStageState } from "@/lib/visual/visualSetupStage";
import { normalizeProductAssetState } from "@/lib/productImages";
import {
  STAGE_LABELS,
  STAGE_RESOURCE,
  StageGateError,
  calculateDependencyImpact,
  createResourceVersionInProject,
  currentResourceVersion,
  ensureStageWorkflow,
  lockStageInProject,
  setStageStatusInProject,
  type DependencyImpact
} from "@/lib/workflow/stageGates";
import { ANONYMOUS_SESSION_MAX_AGE_SECONDS } from "@/lib/session/anonymousSessionShared";
import {
  DEFAULT_SHOT_COUNT,
  DEFAULT_TARGET_DURATION_SEC,
  MAX_SHOT_COUNT,
  MAX_SHOT_DURATION_SEC,
  MIN_SHOT_COUNT,
  MIN_SHOT_DURATION_SEC,
  allocateShotDurations,
  clampTargetDuration,
  getDefaultHeroShotArrayIndex,
  getProjectDurationSec,
  validateShotConfiguration
} from "@/lib/video/shotConfig";

export const anonymousProjectIdSchema = z.string().uuid();
export const MAX_ANONYMOUS_PROJECTS = 3;

export const anonymousProjectCreateInputSchema = z.object({
  templateId: z.literal("cold-brew-demo").optional(),
  name: z.string().trim().min(1).max(120).optional(),
  brief: productBriefSchema.optional(),
  aspectRatio: aspectRatioSchema.optional(),
  platform: platformSchema.optional(),
  durationSec: z.number().int().positive().max(120).optional(),
  targetDurationSec: z.number().int().positive().max(60).optional(),
  shotCount: z.number().int().min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT).optional()
}).strict();

export const anonymousProjectPatchSchema = z.object({
  brief: productBriefSchema.optional(),
  shotCount: z.number().int().min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT).optional(),
  targetDurationSec: z.number().int().positive().max(60).optional(),
  strategy: adStrategySchema.optional(),
  creativeWorkspace: creativeWorkspaceSchema.optional(),
  creativeBible: creativeBibleSchema.optional(),
  visualContinuityBible: visualContinuityBibleSchema.optional(),
  referencePack: referencePackSchema.optional(),
  productVisualSpec: productVisualSpecSchema.optional(),
  characterVisualSpecs: z.array(characterVisualSpecSchema).max(12).optional(),
  sceneVisualSpecs: z.array(sceneVisualSpecSchema).max(12).optional(),
  visualAnchorWorkspace: visualAnchorWorkspaceSchema.optional(),
  keyframeQAResults: z.array(keyframeQAResultSchema).max(120).optional(),
  videoQAResults: z.array(videoQAResultSchema).max(4).optional(),
  narrationPlan: narrationPlanSchema.optional(),
  shotPromptPackages: z.array(detailedShotPromptPackageSchema).max(12).optional(),
  shots: z.array(storyboardShotSchema).min(1).max(12).optional(),
  prompts: z.array(projectPromptSchema).max(12).optional(),
  aspectRatio: aspectRatioSchema.optional(),
  durationSec: z.number().int().positive().max(120).optional(),
  platform: platformSchema.optional(),
  workflowSteps: workflowStepsSchema.optional(),
  stageStates: stageStatesSchema.optional(),
  resourceVersions: z.array(versionedResourceSchema).max(500).optional(),
  dependencyGraph: z.array(dependencyNodeSchema).max(1000).optional(),
  heroShotId: z.string().min(1).nullable().optional(),
  keyframes: z.array(keyframeMetadataSchema).max(60).optional(),
  heroVideo: heroVideoMetadataSchema.nullable().optional(),
  finalVideo: finalVideoMetadataSchema.nullable().optional(),
  narrationAssetId: z.string().uuid().nullable().optional(),
  backgroundMusicAssetId: z.string().uuid().nullable().optional(),
  finalVideoAssetId: z.string().uuid().nullable().optional(),
  status: generationStatusSchema.optional(),
  assets: z.array(assetSchema).optional(),
  finalVideoUrl: z.string().min(1).nullable().optional(),
  generationEvents: z.array(generationEventSchema).max(200).optional()
}).strict();

const anonymousProjectRecordSchema = z.object({
  id: anonymousProjectIdSchema,
  ownerFingerprint: z.string().length(64),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  version: z.number().int().positive(),
  project: generationProjectSchema
}).strict();

export type AnonymousProjectCreateInput = z.infer<typeof anonymousProjectCreateInputSchema>;
export type AnonymousProjectPatch = z.infer<typeof anonymousProjectPatchSchema>;
export type AnonymousProjectRecord = z.infer<typeof anonymousProjectRecordSchema>;

export class AnonymousProjectNotFoundError extends Error {
  readonly code = "PROJECT_NOT_FOUND";

  constructor() {
    super("项目不存在或已失效。");
    this.name = "AnonymousProjectNotFoundError";
  }
}

export class AnonymousProjectLimitError extends Error {
  readonly code = "PROJECT_LIMIT_REACHED";

  constructor() {
    super("当前临时会话最多可以创建 3 个项目。");
    this.name = "AnonymousProjectLimitError";
  }
}

export class AnonymousProjectVersionConflictError extends Error {
  readonly code = "PROJECT_VERSION_CONFLICT";

  constructor() {
    super("项目已在其他请求中更新，请刷新后重试。");
    this.name = "AnonymousProjectVersionConflictError";
  }
}

export class ShotConfigurationError extends Error {
  constructor(readonly code: "INVALID_SHOT_COUNT" | "INVALID_SHOT_DURATION" | "INVALID_TARGET_DURATION" | "SHOT_COUNT_MISMATCH" | "DURATION_PLAN_MISMATCH" | "SHOT_DURATION_PLAN_MISMATCH" | "SHOT_CONFIGURATION_CONFLICT" | "SHOT_COUNT_REQUIRES_REGENERATION") {
    super({
      INVALID_SHOT_COUNT: "分镜数量必须为 3–12 个。",
      INVALID_SHOT_DURATION: "每个分镜时长必须为 3–8 秒。",
      INVALID_TARGET_DURATION: "目标时长不在当前分镜数量允许的范围内。",
      SHOT_COUNT_MISMATCH: "模型返回的分镜数量与项目设置不一致，请重新生成。",
      DURATION_PLAN_MISMATCH: "模型返回的分镜总时长与广告需求中的计划不一致，请重新生成。",
      SHOT_DURATION_PLAN_MISMATCH: "镜头时长计划与项目设置不一致。",
      SHOT_CONFIGURATION_CONFLICT: "镜头配置与当前项目不一致，请刷新后重试。",
      SHOT_COUNT_REQUIRES_REGENERATION: "修改分镜数量需要确认并重新生成完整分镜。"
    }[code]);
    this.name = "ShotConfigurationError";
  }
}
const writeQueues = new Map<string, Promise<void>>();

export function resolveProjectDirectory(sessionId: string, projectId: string): string {
  const safeId = parseProjectId(projectId);
  const sessionNamespace = createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  const root = storageRoot();
  return assertWithinRoot(root, path.resolve(root, "sessions", sessionNamespace, "projects", safeId));
}

export function resolveProjectJsonPath(sessionId: string, projectId: string): string {
  const root = storageRoot();
  return assertWithinRoot(root, path.resolve(resolveProjectDirectory(sessionId, projectId), "project.json"));
}

export async function createAnonymousProject(
  sessionId: string,
  rawInput: AnonymousProjectCreateInput = {}
): Promise<AnonymousProjectRecord> {
  const input = anonymousProjectCreateInputSchema.parse(rawInput);
  return withWriteQueue(`session:${sessionNamespace(sessionId)}`, async () => {
    const current = await listAnonymousProjects(sessionId);
    if (current.length >= MAX_ANONYMOUS_PROJECTS) throw new AnonymousProjectLimitError();

    const id = randomUUID();
    const now = Date.now();
    const project = buildProject(id, now, input);
    const record = anonymousProjectRecordSchema.parse({
      id,
      ownerFingerprint: ownerFingerprint(sessionId),
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ANONYMOUS_SESSION_MAX_AGE_SECONDS * 1000,
      version: 1,
      project
    });
    await writeRecordAtomic(sessionId, record);
    return record;
  });
}

export async function createColdBrewDemoForSession(sessionId: string): Promise<AnonymousProjectRecord> {
  return createAnonymousProject(sessionId, { templateId: "cold-brew-demo" });
}

export async function listAnonymousProjects(sessionId: string): Promise<AnonymousProjectRecord[]> {
  const projectsRoot = path.dirname(resolveProjectDirectory(sessionId, randomUUID()));
  let entries: string[];
  try {
    entries = await readdir(projectsRoot);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const records = await Promise.all(entries.flatMap((entry) => {
    if (!anonymousProjectIdSchema.safeParse(entry).success) return [];
    return [readOwnedRecord(sessionId, entry).catch(() => null)];
  }));
  return records
    .filter((record): record is AnonymousProjectRecord => Boolean(record))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getOwnedAnonymousProject(
  sessionId: string,
  projectId: string
): Promise<AnonymousProjectRecord | null> {
  if (!anonymousProjectIdSchema.safeParse(projectId).success) return null;
  try {
    return await readOwnedRecord(sessionId, projectId);
  } catch (error) {
    if (isMissingFile(error) || error instanceof AnonymousProjectNotFoundError) return null;
    throw error;
  }
}

export async function requireOwnedAnonymousProject(
  sessionId: string,
  projectId: string
): Promise<AnonymousProjectRecord> {
  const record = await getOwnedAnonymousProject(sessionId, projectId);
  if (!record) throw new AnonymousProjectNotFoundError();
  return record;
}

export async function updateOwnedAnonymousProject(
  sessionId: string,
  projectId: string,
  rawPatch: AnonymousProjectPatch,
  expectedVersion?: number
): Promise<AnonymousProjectRecord> {
  const safeId = parseProjectId(projectId);
  const patch = anonymousProjectPatchSchema.parse(rawPatch);
  return withWriteQueue(`project:${sessionNamespace(sessionId)}:${safeId}`, async () => {
    const current = await requireOwnedAnonymousProject(sessionId, safeId);
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new AnonymousProjectVersionConflictError();
    }

    const now = Date.now();
    const candidate: Record<string, unknown> = {
      ...current.project,
      ...patch,
      id: current.id,
      createdAt: current.project.createdAt,
      updatedAt: new Date(now).toISOString()
    };
    if (patch.shots) {
      const totalDurationSec = getProjectDurationSec({ shots: patch.shots });
      if (patch.shots.length >= MIN_SHOT_COUNT) candidate.shotCount = patch.shots.length;
      else delete candidate.shotCount;
      candidate.durationSec = totalDurationSec;
      candidate.brief = {
        ...(current.project.brief),
        ...(patch.brief ?? {}),
        durationSec: patch.targetDurationSec ?? current.project.targetDurationSec ?? current.project.brief.durationSec
      };
      if (patch.shotCount !== undefined) {
        candidate.planningConstraints = planningConstraintsFromBrief(
          (candidate.brief as GenerationProject["brief"]),
          patch.shotCount,
          patch.targetDurationSec ?? current.project.targetDurationSec ?? current.project.brief.durationSec
        );
      }
    } else if (patch.brief) {
      candidate.brief = {
        ...patch.brief,
        durationSec: patch.targetDurationSec ?? current.project.targetDurationSec ?? patch.brief.durationSec
      };
    }
    if (patch.heroShotId === null) delete candidate.heroShotId;
    if (patch.heroVideo === null) delete candidate.heroVideo;
    if (patch.finalVideo === null) delete candidate.finalVideo;
    if (patch.narrationAssetId === null) delete candidate.narrationAssetId;
    if (patch.backgroundMusicAssetId === null) delete candidate.backgroundMusicAssetId;
    if (patch.finalVideoAssetId === null) delete candidate.finalVideoAssetId;
    const nextProject = sanitizeProjectForStorage(normalizeProjectTimeline(generationProjectSchema.parse(candidate)));
    const nextRecord = anonymousProjectRecordSchema.parse({
      ...current,
      updatedAt: now,
      version: current.version + 1,
      project: nextProject
    });
    await writeRecordAtomic(sessionId, nextRecord);
    return nextRecord;
  });
}

const savedBriefInputSchema = z.object({
  brief: productBriefSchema,
  shotCount: z.number().int().min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT),
  targetDurationSec: z.number().int().positive().max(60),
  createVersion: z.boolean().optional()
}).strict();

export async function saveOwnedProjectBrief(
  sessionId: string,
  projectId: string,
  rawInput: z.input<typeof savedBriefInputSchema>,
  expectedVersion?: number
): Promise<AnonymousProjectRecord> {
  const input = savedBriefInputSchema.parse(rawInput);
  const targetDurationSec = clampTargetDuration(input.shotCount, input.targetDurationSec);
  if (targetDurationSec !== input.targetDurationSec) throw new ShotConfigurationError("INVALID_TARGET_DURATION");

  return mutateOwnedAnonymousProject(sessionId, projectId, (project) => {
    const normalized = ensureStageWorkflow(project);
    const briefChanged = !sameBriefRevision(normalized, input);
    const briefWasLocked = normalized.stageStates?.brief.status === "locked";
    if (briefWasLocked && briefChanged && !input.createVersion) {
      const currentVersion = currentResourceVersion(normalized.resourceVersions ?? [], "brief")?.version ?? 1;
      throw new StageGateError(
        "LOCKED_RESOURCE_VERSION_REQUIRED",
        "广告需求已锁定，修改将创建新版本。",
        calculateDependencyImpact(normalized.dependencyGraph ?? [], "brief", currentVersion, currentVersion + 1)
      );
    }
    const previousShotCount = project.shotCount ?? project.shots.length;
    const storyboardExists = project.workflowSteps?.storyboard === "completed" || project.workflowSteps?.storyboard === "fallback";
    if (storyboardExists && previousShotCount !== input.shotCount) {
      throw new ShotConfigurationError("SHOT_COUNT_REQUIRES_REGENERATION");
    }

    const plan = allocateShotDurations(input.shotCount, targetDurationSec);
    const shots = resizeProjectShots(project.shots, input.shotCount, plan);
    const previousTarget = project.targetDurationSec ?? project.brief.durationSec;
    const targetChanged = targetDurationSec !== previousTarget;
    const heroShot = shots.find((shot) => shot.id === project.heroShotId);
    const heroDurationMismatch = Boolean(
      targetChanged && heroShot && ["wan-api", "happyhorse-api"].includes(project.heroVideo?.source ?? "") && project.heroVideo?.durationSec
      && Math.abs(project.heroVideo.durationSec - heroShot.durationSec) > 0.75
    );
    const currentProductImages = new Map(
      (project.brief.productImages ?? []).map((image) => [image.id, image])
    );
    const incomingProductImages = input.brief.productImages === undefined
      ? project.brief.productImages
      : input.brief.productImages.map((image) => {
          const currentImage = currentProductImages.get(image.id);
          if (!currentImage?.assetId) return image;
          return {
            ...image,
            assetId: currentImage.assetId,
            localUrl: currentImage.localUrl ?? image.localUrl,
            previewUrl: undefined
          };
        });
    const normalizedBrief = normalizeProductAssetState(
      { ...input.brief, durationSec: targetDurationSec, productImages: incomingProductImages },
      project.brief.primaryProductAssetId
    );
    let next: GenerationProject = {
      ...normalized,
      brief: normalizedBrief,
      planningConstraints: planningConstraintsFromBrief(input.brief, input.shotCount, targetDurationSec),
      shotCount: input.shotCount,
      targetDurationSec,
      durationSec: shots.reduce((sum, shot) => sum + shot.durationSec, 0),
      shots,
      prompts: promptsFromShots(shots),
      briefStatus: "saved",
      briefSavedAt: Date.now(),
      briefRevision: (project.briefRevision ?? 0) + 1,
      workflowSteps: {
        ...(project.workflowSteps ?? initialWorkflow()),
        brief: "completed",
        ...(targetChanged ? {
          heroShot: heroDurationMismatch ? "failed" as const : (project.workflowSteps?.heroShot ?? "pending"),
          render: "pending" as const
        } : {})
      },
      ...(targetChanged && project.finalVideo ? { finalVideo: { ...project.finalVideo, status: "outdated", progress: 0 } } : {}),
      ...(heroDurationMismatch && project.heroVideo ? { heroVideo: { ...project.heroVideo, status: "duration-mismatch" } } : {}),
      ...(targetChanged ? { finalVideoUrl: null } : {})
    };
    if (targetChanged) {
      delete next.finalVideoAssetId;
      delete next.narrationAssetId;
      delete next.narrationPlan;
    }
    if (briefChanged) {
      const currentBriefVersion = currentResourceVersion(next.resourceVersions ?? [], "brief");
      if (!currentBriefVersion) {
        const created = createResourceVersionInProject(next, {
          resourceId: "brief",
          resourceType: "brief",
          stageId: "brief",
          label: "广告需求 V1",
          snapshot: briefSnapshot(next)
        });
        next = created.project;
      } else if (briefWasLocked || hasDownstreamStageOutput(next)) {
        const created = createResourceVersionInProject(next, {
          resourceId: "brief",
          resourceType: "brief",
          stageId: "brief",
          label: `广告需求 V${currentBriefVersion.version + 1}`,
          snapshot: briefSnapshot(next)
        });
        next = appendVersionEvents(created.project, created.impact, "广告需求", currentBriefVersion.version + 1);
      } else {
        next = {
          ...next,
          stageStates: { ...next.stageStates!, brief: { status: "ready", updatedAt: Date.now() } },
          resourceVersions: (next.resourceVersions ?? []).map((item) => item.id === currentBriefVersion.id
            ? { ...item, snapshot: briefSnapshot(next), createdAt: Date.now() }
            : item)
        };
      }
    } else {
      next = {
        ...next,
        stageStates: { ...next.stageStates!, brief: { status: "ready", updatedAt: Date.now() } }
      };
    }
    return next;
  }, expectedVersion);
}

export async function mutateOwnedAnonymousProject(
  sessionId: string,
  projectId: string,
  mutate: (project: GenerationProject) => GenerationProject,
  expectedVersion?: number
): Promise<AnonymousProjectRecord> {
  const safeId = parseProjectId(projectId);
  return withWriteQueue(`project:${sessionNamespace(sessionId)}:${safeId}`, async () => {
    const current = await requireOwnedAnonymousProject(sessionId, safeId);
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new AnonymousProjectVersionConflictError();
    }
    const now = Date.now();
    const mutated = mutate(clone(current.project));
    const parsedProject = generationProjectSchema.parse({
      ...mutated,
      id: current.id,
      createdAt: current.project.createdAt,
      updatedAt: new Date(now).toISOString()
    });
    const nextProject = sanitizeProjectForStorage(normalizeProjectTimeline({
      ...parsedProject,
      brief: normalizeProductAssetState(parsedProject.brief)
    }));
    const nextRecord = anonymousProjectRecordSchema.parse({
      ...current,
      updatedAt: now,
      version: current.version + 1,
      project: nextProject
    });
    await writeRecordAtomic(sessionId, nextRecord);
    return nextRecord;
  });
}
export async function deleteOwnedAnonymousProject(sessionId: string, projectId: string): Promise<void> {
  const safeId = parseProjectId(projectId);
  await withWriteQueue(`project:${sessionNamespace(sessionId)}:${safeId}`, async () => {
    await requireOwnedAnonymousProject(sessionId, safeId);
    await rm(resolveProjectDirectory(sessionId, safeId), { recursive: true, force: true });
  });
}

const shotDurationUpdateSchema = z.object({
  shotId: z.string().min(1),
  durationSec: z.number().int().min(MIN_SHOT_DURATION_SEC).max(MAX_SHOT_DURATION_SEC)
}).strict();

export async function replaceOwnedProjectShots(
  sessionId: string,
  projectId: string,
  shots: StoryboardShot[],
  expectedVersion?: number,
  options: { invalidateExistingAssets?: boolean } = {}
): Promise<AnonymousProjectRecord> {
  const current = await requireOwnedAnonymousProject(sessionId, projectId);
  try {
    assertStoryboardMatchesPlanning(current.project, shots);
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new ShotConfigurationError(code === "DURATION_PLAN_MISMATCH" ? "DURATION_PLAN_MISMATCH" : "SHOT_COUNT_MISMATCH");
  }
  const constraints = resolveProjectPlanningConstraints(current.project);
  const validation = validateShotConfiguration(constraints.shotCount, shots, allocateShotDurations(constraints.shotCount, constraints.targetDurationSec));
  if (!validation.valid) {
    const code = validation.errors[0]?.code;
    throw new ShotConfigurationError(code === "SHOT_DURATION_PLAN_MISMATCH" ? "DURATION_PLAN_MISMATCH" : code ?? "SHOT_CONFIGURATION_CONFLICT");
  }
  const previousIds = current.project.shots.map((shot) => shot.id).join("|");
  const nextIds = shots.map((shot) => shot.id).join("|");
  const identitiesChanged = previousIds !== nextIds;
  const heroIndex = getDefaultHeroShotArrayIndex(shots.length);
  const event = generationEventSchema.parse({
    id: randomUUID(),
    runId: randomUUID(),
    projectId,
    stage: "storyboard",
    provider: "system",
    action: identitiesChanged ? "重新生成分镜数量" : "保存分镜",
    status: "completed",
    message: `分镜已更新为 ${shots.length} 个，总时长 ${validation.totalDurationSec} 秒。`,
    progressCurrent: shots.length,
    progressTotal: shots.length,
    startedAt: Date.now(),
    completedAt: Date.now()
  });
  return updateOwnedAnonymousProject(sessionId, projectId, {
    shotCount: constraints.shotCount,
    shots,
    prompts: promptsFromShots(shots),
    durationSec: validation.totalDurationSec,
    brief: { ...current.project.brief, durationSec: constraints.targetDurationSec },
    heroShotId: options.invalidateExistingAssets ? null : shots[heroIndex]!.id,
    ...(identitiesChanged || options.invalidateExistingAssets ? {
      keyframes: [],
      heroVideo: null,
      finalVideo: null,
      narrationAssetId: null,
      finalVideoAssetId: null,
      finalVideoUrl: null,
      workflowSteps: {
        brief: "completed",
        strategy: "completed",
        storyboard: "completed",
        keyframes: "pending",
        heroShot: "pending",
        render: "pending"
      }
    } : {}),
    generationEvents: [...(current.project.generationEvents ?? []).slice(-199), event]
  }, expectedVersion ?? current.version);
}

export async function saveOwnedStoryboardChunk(
  sessionId: string,
  projectId: string,
  chunk: StoryboardShot[]
): Promise<AnonymousProjectRecord> {
  const current = await requireOwnedAnonymousProject(sessionId, projectId);
  const constraints = resolveProjectPlanningConstraints(current.project);
  const durations = allocateShotDurations(constraints.shotCount, constraints.targetDurationSec);
  const byIndex = new Map(chunk.map((shot) => [shot.index, shot]));
  const invalid = chunk.some((shot) => shot.index < 1
    || shot.index > constraints.shotCount
    || shot.durationSec !== durations[shot.index - 1]);
  if (!chunk.length || invalid || byIndex.size !== chunk.length) {
    throw new ShotConfigurationError("DURATION_PLAN_MISMATCH");
  }

  if (current.project.shots.length !== constraints.shotCount) {
    throw new ShotConfigurationError("SHOT_COUNT_MISMATCH");
  }
  const baseline = current.project.shots;
  const merged = ensureStoryboardArchitecture(baseline.map((shot, index) => byIndex.get(index + 1) ?? shot));
  return updateOwnedAnonymousProject(sessionId, projectId, {
    shots: merged,
    prompts: promptsFromShots(merged)
  }, current.version);
}

export async function updateOwnedShotDurations(
  sessionId: string,
  projectId: string,
  rawUpdates: Array<{ shotId: string; durationSec: number }>,
  expectedVersion?: number
): Promise<AnonymousProjectRecord> {
  const parsedUpdates = z.array(shotDurationUpdateSchema).min(1).max(MAX_SHOT_COUNT).safeParse(rawUpdates);
  if (!parsedUpdates.success) {
    throw new ShotConfigurationError("INVALID_SHOT_DURATION");
  }
  const updates = parsedUpdates.data;
  if (new Set(updates.map((item) => item.shotId)).size !== updates.length) {
    throw new ShotConfigurationError("SHOT_CONFIGURATION_CONFLICT");
  }
  return mutateOwnedAnonymousProject(sessionId, projectId, (project) => {
    const byId = new Map(updates.map((item) => [item.shotId, item.durationSec]));
    if (updates.some((item) => !project.shots.some((shot) => shot.id === item.shotId))) {
      throw new ShotConfigurationError("SHOT_CONFIGURATION_CONFLICT");
    }
    const previousById = new Map(project.shots.map((shot) => [shot.id, shot.durationSec]));
    const shots = project.shots.map((shot) => ({
      ...shot,
      durationSec: byId.get(shot.id) ?? shot.durationSec
    }));
    const validation = validateShotConfiguration(shots.length, shots);
    if (!validation.valid) throw new ShotConfigurationError(validation.errors[0]?.code ?? "SHOT_CONFIGURATION_CONFLICT");
    const heroShot = shots.find((shot) => shot.id === project.heroShotId);
    const heroDurationMismatch = Boolean(
      heroShot
      && ["wan-api", "happyhorse-api"].includes(project.heroVideo?.source ?? "")
      && project.heroVideo?.durationSec
      && Math.abs(project.heroVideo.durationSec - heroShot.durationSec) > 0.75
    );
    const changeSummary = updates.map((item) => {
      const previous = previousById.get(item.shotId);
      const shot = shots.find((candidate) => candidate.id === item.shotId);
      return `镜头 ${shot?.index ?? item.shotId} 由 ${previous} 秒调整为 ${item.durationSec} 秒`;
    }).join("；");
    const event = generationEventSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      projectId,
      stage: "storyboard",
      provider: "system",
      action: "修改镜头时长",
      status: "completed",
      message: `${changeSummary}，项目总时长更新为 ${validation.totalDurationSec} 秒。`,
      startedAt: Date.now(),
      completedAt: Date.now()
    });
    const next: GenerationProject = {
      ...project,
      shotCount: shots.length >= MIN_SHOT_COUNT ? shots.length : undefined,
      shots,
      prompts: promptsFromShots(shots),
      brief: { ...project.brief, durationSec: project.targetDurationSec ?? project.brief.durationSec },
      durationSec: validation.totalDurationSec,
      workflowSteps: {
        ...(project.workflowSteps ?? initialWorkflow()),
        heroShot: heroDurationMismatch ? "failed" : (project.workflowSteps?.heroShot ?? "pending"),
        render: "pending"
      },
      ...(project.finalVideo ? { finalVideo: { ...project.finalVideo, status: "outdated", progress: 0 } } : {}),
      ...(heroDurationMismatch && project.heroVideo
        ? { heroVideo: { ...project.heroVideo, status: "duration-mismatch" } }
        : {}),
      finalVideoUrl: null,
      generationEvents: [...(project.generationEvents ?? []).slice(-199), event]
    };
    delete next.finalVideoAssetId;
    delete next.narrationAssetId;
    delete next.narrationPlan;
    return next;
  }, expectedVersion);
}

export async function updateOwnedHeroShot(
  sessionId: string,
  projectId: string,
  shotId: string,
  expectedVersion?: number
): Promise<AnonymousProjectRecord> {
  const current = await requireOwnedAnonymousProject(sessionId, projectId);
  if (!current.project.shots.some((shot) => shot.id === shotId)) {
    throw new Error("HERO_SHOT_NOT_IN_PROJECT");
  }
  return updateOwnedAnonymousProject(sessionId, projectId, { heroShotId: shotId }, expectedVersion);
}

export function updateOwnedWorkflowState(
  sessionId: string,
  projectId: string,
  workflowSteps: WorkflowSteps,
  expectedVersion?: number
): Promise<AnonymousProjectRecord> {
  return updateOwnedAnonymousProject(sessionId, projectId, { workflowSteps }, expectedVersion);
}

export function lockOwnedProjectStage(
  sessionId: string,
  projectId: string,
  stageId: StageId,
  expectedVersion?: number
): Promise<AnonymousProjectRecord> {
  return mutateOwnedAnonymousProject(sessionId, projectId, (project) => {
    const next = lockStageInProject(project, stageId);
    return appendSystemEvent(next, {
      stage: stageId,
      action: "锁定阶段",
      message: `${STAGE_LABELS[stageId]}已由用户锁定。`
    });
  }, expectedVersion);
}

export function confirmOwnedVisualSetup(
  sessionId: string,
  projectId: string,
  expectedVersion?: number
): Promise<AnonymousProjectRecord> {
  return mutateOwnedAnonymousProject(sessionId, projectId, (project) => {
    const visualSetup = deriveVisualSetupStageState(project);
    if (!visualSetup.allItemsConfirmed) {
      throw new StageGateError(
        "VISUAL_ANCHORS_INCOMPLETE",
        visualSetup.blockers.map((item) => item.title).join("；") || "人物与场景确认失败，请重试。"
      );
    }
    if (visualSetup.status === "completed") return project;
    const normalized = ensureStageWorkflow(project);
    const readyProject: GenerationProject = {
      ...normalized,
      stageStates: {
        ...normalized.stageStates!,
        anchors: { status: "ready", updatedAt: Date.now() }
      }
    };
    return appendSystemEvent(lockStageInProject(readyProject, "anchors"), {
      stage: "anchors",
      action: "确认人物与场景",
      message: "人物与场景设置已确认。"
    });
  }, expectedVersion);
}

export function setOwnedProjectStageStatus(
  sessionId: string,
  projectId: string,
  stageId: StageId,
  status: "draft" | "running" | "ready" | "failed",
  expectedVersion?: number,
  errorCode?: string
): Promise<AnonymousProjectRecord> {
  return mutateOwnedAnonymousProject(sessionId, projectId, (project) =>
    setStageStatusInProject(project, stageId, status, Date.now(), errorCode), expectedVersion);
}

export async function calculateOwnedProjectDependencyImpact(
  sessionId: string,
  projectId: string,
  resourceId: string
): Promise<DependencyImpact> {
  const record = await requireOwnedAnonymousProject(sessionId, projectId);
  const project = ensureStageWorkflow(record.project);
  const current = currentResourceVersion(project.resourceVersions ?? [], resourceId);
  const currentVersion = current?.version ?? 1;
  return calculateDependencyImpact(project.dependencyGraph ?? [], resourceId, currentVersion, currentVersion + 1);
}

export function createOwnedProjectResourceVersion(
  sessionId: string,
  projectId: string,
  input: {
    resourceId: string;
    resourceType: VersionedResourceType;
    stageId: StageId;
    label?: string;
  },
  expectedVersion?: number
): Promise<AnonymousProjectRecord> {
  return mutateOwnedAnonymousProject(sessionId, projectId, (project) => {
    const normalized = ensureStageWorkflow(project);
    const created = createResourceVersionInProject(normalized, {
      ...input,
      snapshot: stageSnapshot(normalized, input.stageId)
    });
    return appendVersionEvents(created.project, created.impact, STAGE_LABELS[input.stageId], created.version.version);
  }, expectedVersion);
}

export function resetAnonymousProjectQueuesForTests(): void {
  writeQueues.clear();
}

function buildProject(id: string, now: number, input: AnonymousProjectCreateInput): GenerationProject {
  const template = clone(coldBrewDemo);
  const shotCount = input.shotCount ?? DEFAULT_SHOT_COUNT;
  const targetDurationSec = clampTargetDuration(shotCount, input.targetDurationSec ?? input.durationSec ?? DEFAULT_TARGET_DURATION_SEC);
  const shotDurations = allocateShotDurations(shotCount, targetDurationSec);
  const shots = shotDurations.map((durationSec, zeroBasedIndex) => {
    const source = template.shots[zeroBasedIndex % template.shots.length]!;
    const index = zeroBasedIndex + 1;
    return storyboardShotSchema.parse({
      ...source,
      id: `shot-${String(index).padStart(2, "0")}-draft`,
      index,
      durationSec
    });
  });
  const totalDurationSec = getProjectDurationSec({ shots });
  const brief = productBriefSchema.parse({
    ...(input.brief ?? template.brief),
    ...(input.name ? { productName: input.name } : {}),
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.platform ? { platform: input.platform } : {}),
    durationSec: targetDurationSec
  });
  const isTemplate = input.templateId === "cold-brew-demo";
  const heroShotId = shots[getDefaultHeroShotArrayIndex(shots.length)]!.id;
  const continuity = ensureProjectContinuity({
    ...template,
    id,
    brief,
    shots,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
  const project = generationProjectSchema.parse({
    ...template,
    id,
    planningConstraints: planningConstraintsFromBrief(brief, shotCount, targetDurationSec),
    shotCount,
    targetDurationSec,
    briefStatus: isTemplate ? "saved" : "draft",
    briefSavedAt: isTemplate ? now : undefined,
    briefRevision: isTemplate ? 1 : 0,
    brief,
    shots: ensureStoryboardArchitecture(continuity.shots),
    creativeBible: continuity.creativeBible,
    visualContinuityBible: continuity.visualContinuityBible,
    referencePack: continuity.referencePack,
    heroShotId,
    aspectRatio: brief.aspectRatio,
    durationSec: totalDurationSec,
    platform: brief.platform,
    prompts: promptsFromShots(shots),
    workflowSteps: isTemplate ? completedWorkflow() : initialWorkflow(),
    keyframes: [],
    heroVideo: undefined,
    finalVideo: undefined,
    finalVideoUrl: null,
    generationEvents: [],
    status: isTemplate ? "ready" : "draft",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
  project.narrationPlan = buildPartialNarrationPlan(project);
  return sanitizeProjectForStorage(ensureVisualAnchorWorkspace(ensureStageWorkflow(project, now), new Date(now).toISOString()));
}

function sanitizeProjectForStorage(project: GenerationProject): GenerationProject {
  const copy = clone(project);
  copy.brief.productImages = copy.brief.productImages?.map((image) => {
    const next = { ...image };
    if (isTransientUrl(next.previewUrl)) delete next.previewUrl;
    if (isTransientUrl(next.remoteUrl)) delete next.remoteUrl;
    if (isTransientUrl(next.url)) delete next.url;
    return next;
  });
  return generationProjectSchema.parse(copy);
}

function normalizeProjectTimeline(project: GenerationProject): GenerationProject {
  const totalDurationSec = getProjectDurationSec(project);
  const constraints = resolveProjectPlanningConstraints(project);
  const shotCount = constraints.shotCount;
  const targetDurationSec = constraints.targetDurationSec;
  const continuity = ensureProjectContinuity(project);
  const architectureShots = ensureStoryboardArchitecture(continuity.shots);
  const firstFrameIdByShot = new Map(architectureShots.map((shot) => [shot.id, shot.frames?.[0]?.id]));
  const keyframes = project.keyframes?.map((keyframe) => ({
    ...keyframe,
    frameId: keyframe.frameId ?? firstFrameIdByShot.get(keyframe.shotId)
  }));
  const keyframeQAResults = project.keyframeQAResults?.map((result) => ({
    ...result,
    frameId: result.frameId ?? firstFrameIdByShot.get(result.shotId)
  }));
  const shots = architectureShots.map((shot) => {
    const first = shot.frames?.[0];
    const legacy = keyframes?.find((keyframe) => keyframe.shotId === shot.id && keyframe.frameId === first?.id);
    if (!first || !legacy?.assetId) return shot;
    return {
      ...shot,
      primaryKeyframeAssetId: shot.primaryKeyframeAssetId ?? legacy.assetId,
      frames: shot.frames?.map((frame, index) => index === 0 ? {
        ...frame,
        assetId: frame.assetId ?? legacy.assetId,
        status: legacy.status === "ready" ? "ready" as const
          : legacy.status === "needs-review" ? "needs-review" as const
            : legacy.status === "failed" || legacy.status === "fallback" ? "failed" as const
              : frame.status
      } : frame)
    };
  });
  const staged = ensureStageWorkflow({
    ...project,
    shots,
    keyframes,
    keyframeQAResults,
    creativeBible: continuity.creativeBible,
    visualContinuityBible: continuity.visualContinuityBible,
    referencePack: continuity.referencePack,
    planningConstraints: constraints,
    shotCount,
    targetDurationSec,
    briefStatus: project.briefStatus ?? (project.status === "draft" ? "draft" : "saved"),
    briefRevision: project.briefRevision ?? 0,
    brief: { ...project.brief, durationSec: targetDurationSec },
    durationSec: totalDurationSec
  });
  return ensureVisualAnchorWorkspace(staged);
}

function resizeProjectShots(source: StoryboardShot[], shotCount: number, durations: number[]): StoryboardShot[] {
  return durations.map((durationSec, zeroBasedIndex) => {
    const index = zeroBasedIndex + 1;
    const base = source[zeroBasedIndex] ?? source[zeroBasedIndex % source.length]!;
    return storyboardShotSchema.parse({
      ...base,
      id: base?.id && zeroBasedIndex < source.length ? base.id : `shot-${String(index).padStart(2, "0")}-draft`,
      index,
      durationSec
    });
  });
}
function promptsFromShots(shots: StoryboardShot[]) {
  return shots.map((shot) => ({
    shotId: shot.id,
    imagePromptCn: shot.imagePromptCn,
    imagePromptEn: shot.imagePromptEn,
    videoPromptCn: shot.videoPromptCn
  }));
}

function initialWorkflow(): WorkflowSteps {
  return {
    brief: "pending",
    strategy: "pending",
    storyboard: "pending",
    keyframes: "pending",
    heroShot: "pending",
    render: "pending"
  };
}

function completedWorkflow(): WorkflowSteps {
  return {
    brief: "completed",
    strategy: "completed",
    storyboard: "completed",
    keyframes: "fallback",
    heroShot: "pending",
    render: "pending"
  };
}

async function readOwnedRecord(sessionId: string, projectId: string): Promise<AnonymousProjectRecord> {
  const raw = await readFile(resolveProjectJsonPath(sessionId, projectId), "utf8");
  const parsedRecord = anonymousProjectRecordSchema.parse(JSON.parse(raw));
  const record: AnonymousProjectRecord = { ...parsedRecord, project: normalizeProjectTimeline(parsedRecord.project) };
  if (record.ownerFingerprint !== ownerFingerprint(sessionId) || record.expiresAt <= Date.now()) {
    throw new AnonymousProjectNotFoundError();
  }
  return record;
}

async function writeRecordAtomic(sessionId: string, record: AnonymousProjectRecord): Promise<void> {
  const directory = resolveProjectDirectory(sessionId, record.id);
  const destination = resolveProjectJsonPath(sessionId, record.id);
  const temporary = assertWithinRoot(storageRoot(), `${destination}.tmp-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithTransientRetry(temporary, destination);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function withWriteQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  writeQueues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writeQueues.get(key) === queued) writeQueues.delete(key);
  }
}

function ownerFingerprint(sessionId: string): string {
  return createHash("sha256").update(`${sessionId}:${ownershipSalt()}`).digest("hex");
}

function ownershipSalt(): string {
  const configured = process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ANONYMOUS_SESSION_OWNERSHIP_SALT is required in production.");
  }
  return "ad-director-local-ownership-salt";
}

function sameBriefRevision(project: GenerationProject, input: z.infer<typeof savedBriefInputSchema>): boolean {
  const current = {
    brief: comparableBrief(project.brief),
    shotCount: project.shotCount ?? project.shots.length,
    targetDurationSec: project.targetDurationSec ?? project.brief.durationSec
  };
  const incoming = {
    brief: comparableBrief({ ...input.brief, durationSec: input.targetDurationSec }),
    shotCount: input.shotCount,
    targetDurationSec: input.targetDurationSec
  };
  return JSON.stringify(current) === JSON.stringify(incoming);
}

function comparableBrief(brief: GenerationProject["brief"]) {
  return {
    ...brief,
    productImages: brief.productImages?.map(({ previewUrl: _previewUrl, remoteUrl: _remoteUrl, url: _url, ...image }) => image)
  };
}

function briefSnapshot(project: GenerationProject) {
  return {
    brief: project.brief,
    planningConstraints: resolveProjectPlanningConstraints(project),
    shotCount: project.shotCount ?? project.shots.length,
    targetDurationSec: project.targetDurationSec ?? project.brief.durationSec
  };
}

function hasDownstreamStageOutput(project: GenerationProject): boolean {
  const states = ensureStageWorkflow(project).stageStates!;
  return (["creative", "anchors", "storyboard", "keyframes", "video", "final"] as StageId[])
    .some((stageId) => states[stageId].status !== "blocked" && states[stageId].status !== "draft");
}

function stageSnapshot(project: GenerationProject, stageId: StageId): unknown {
  const resourceId = STAGE_RESOURCE[stageId].resourceId;
  if (resourceId === "brief") return briefSnapshot(project);
  if (resourceId === "creative-direction") return { strategy: project.strategy, creativeBible: project.creativeBible, creativeWorkspace: project.creativeWorkspace };
  if (resourceId === "visual-anchors") return {
    productVisualSpec: project.productVisualSpec,
    characterVisualSpecs: project.characterVisualSpecs,
    sceneVisualSpecs: project.sceneVisualSpecs,
    visualAnchorWorkspace: project.visualAnchorWorkspace,
    visualContinuityBible: project.visualContinuityBible,
    referencePack: project.referencePack
  };
  if (resourceId === "storyboard") return { shots: project.shots, narrationPlan: project.narrationPlan, shotPromptPackages: project.shotPromptPackages };
  if (resourceId === "keyframes") return { keyframes: project.keyframes, keyframeQAResults: project.keyframeQAResults };
  if (resourceId === "shot-videos") return { heroVideo: project.heroVideo, narrationAssetId: project.narrationAssetId, videoQAResults: project.videoQAResults };
  return { finalVideo: project.finalVideo, finalVideoAssetId: project.finalVideoAssetId };
}

function appendVersionEvents(project: GenerationProject, impact: DependencyImpact, label: string, version: number): GenerationProject {
  let next = appendSystemEvent(project, {
    stage: stageForResource(impact.resourceId),
    action: "创建资源版本",
    message: `${label}已创建 V${version}，旧版本继续保留。`
  });
  if (impact.affectedStages.length > 0) {
    next = appendSystemEvent(next, {
      stage: stageForResource(impact.resourceId),
      action: "标记下游过期",
      message: `依赖影响已计算：${impact.affectedStages.map((stageId) => STAGE_LABELS[stageId]).join("、")}标记为 outdated，未自动删除或重新生成。`
    });
  }
  return next;
}

function appendSystemEvent(
  project: GenerationProject,
  input: { stage: StageId; action: string; message: string }
): GenerationProject {
  const now = Date.now();
  const event = generationEventSchema.parse({
    id: randomUUID(),
    runId: randomUUID(),
    projectId: project.id,
    stage: input.stage,
    provider: "system",
    action: input.action,
    status: "completed",
    message: input.message,
    startedAt: now,
    completedAt: now
  });
  return { ...project, generationEvents: [...(project.generationEvents ?? []).slice(-199), event] };
}

function stageForResource(resourceId: string): StageId {
  return (Object.entries(STAGE_RESOURCE) as Array<[StageId, { resourceId: string }]>)
    .find(([, resource]) => resource.resourceId === resourceId)?.[0] ?? "brief";
}

function storageRoot(): string {
  return path.resolve(process.env.STORAGE_ROOT?.trim() || path.join(process.cwd(), "storage"));
}

function sessionNamespace(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function parseProjectId(value: string): string {
  return anonymousProjectIdSchema.parse(value);
}

function assertWithinRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("UNSAFE_PROJECT_STORAGE_PATH");
  }
  return resolvedCandidate;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isTransientUrl(value: string | undefined): boolean {
  return Boolean(value && (/^blob:/i.test(value) || /^data:/i.test(value)));
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function renameWithTransientRetry(source: string, destination: string): Promise<void> {
  const retryableCodes = new Set(["EPERM", "EBUSY", "EACCES"]);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (!retryableCodes.has(code) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 12 * (attempt + 1)));
    }
  }
}
