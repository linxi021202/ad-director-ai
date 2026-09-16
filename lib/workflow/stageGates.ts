import type {
  DependencyNode,
  DependencyRef,
  GenerationProject,
  StageId,
  StageState,
  StageStates,
  VersionedResource,
  VersionedResourceType
} from "@/lib/schemas/project";
import { currentMasterAssetId } from "@/lib/visual/visualAnchors";
import { deriveVisualSetupStageState } from "@/lib/visual/visualSetupStage";

export const STAGE_ORDER: StageId[] = [
  "brief",
  "creative",
  "anchors",
  "storyboard",
  "keyframes",
  "video",
  "final"
];

export const STAGE_LABELS: Record<StageId, string> = {
  brief: "广告需求",
  creative: "创意方向",
  anchors: "视觉基准",
  storyboard: "文字分镜",
  keyframes: "关键帧",
  video: "视频与配音",
  final: "最终成片"
};

export const STAGE_RESOURCE: Record<StageId, { resourceId: string; resourceType: VersionedResourceType }> = {
  brief: { resourceId: "brief", resourceType: "brief" },
  creative: { resourceId: "creative-direction", resourceType: "creative-direction" },
  anchors: { resourceId: "visual-anchors", resourceType: "visual-anchors" },
  storyboard: { resourceId: "storyboard", resourceType: "storyboard" },
  keyframes: { resourceId: "keyframes", resourceType: "shot-frame" },
  video: { resourceId: "shot-videos", resourceType: "shot-video" },
  final: { resourceId: "final", resourceType: "final" }
};

export type DependencyImpact = {
  resourceId: string;
  currentVersion: number;
  nextVersion: number;
  affectedStages: StageId[];
  affectedShotIds: string[];
  affectedFrameIds: string[];
  affectedVideoIds: string[];
  affectedNarrationIds: string[];
  finalAffected: boolean;
};

export class StageGateError extends Error {
  constructor(
    readonly code:
      | "STAGE_NOT_READY"
      | "STAGE_PREREQUISITE_NOT_LOCKED"
      | "BRIEF_NOT_LOCKED"
      | "CREATIVE_NOT_LOCKED"
      | "VISUAL_ANCHOR_NOT_LOCKED"
      | "STORYBOARD_NOT_LOCKED"
      | "VISUAL_ANCHORS_INCOMPLETE"
      | "LOCKED_RESOURCE_VERSION_REQUIRED",
    message: string,
    readonly impact?: DependencyImpact
  ) {
    super(message);
    this.name = "StageGateError";
  }
}

export function createInitialStageStates(project: GenerationProject, now = Date.now()): StageStates {
  const old = project.workflowSteps;
  const ready = (value: string | undefined) => value === "completed" || value === "fallback" || value === "needs-review";
  const briefReady = project.briefStatus === "saved";
  const creativeReady = ready(old?.strategy);
  const anchorsReady = Boolean(project.referencePack || project.visualContinuityBible) && creativeReady;
  const storyboardReady = ready(old?.storyboard);
  const keyframesReady = Boolean(project.keyframes?.length) || ready(old?.keyframes);
  const videoReady = Boolean(project.heroVideo) || ready(old?.heroShot);
  const finalReady = Boolean(project.finalVideo || project.finalVideoAssetId || project.finalVideoUrl) || ready(old?.render);

  const status = (isReady: boolean, isDraft = false): StageState => ({
    status: isReady ? "ready" : isDraft ? "draft" : "blocked",
    updatedAt: now
  });

  return {
    brief: status(briefReady, !briefReady),
    creative: status(creativeReady),
    anchors: status(anchorsReady),
    storyboard: status(storyboardReady),
    keyframes: status(keyframesReady),
    video: status(videoReady),
    final: status(finalReady)
  };
}

export function ensureStageWorkflow(project: GenerationProject, now = Date.now()): GenerationProject {
  const stageStates = project.stageStates ?? createInitialStageStates(project, now);
  const resourceVersions = project.resourceVersions?.length
    ? project.resourceVersions
    : seedResourceVersions(project, stageStates, now);
  const dependencyGraph = mergeDependencyGraph(project, resourceVersions);
  return { ...project, stageStates, resourceVersions, dependencyGraph };
}

export function getStagePrerequisite(stageId: StageId): StageId | null {
  const index = STAGE_ORDER.indexOf(stageId);
  return index > 0 ? STAGE_ORDER[index - 1]! : null;
}

export function canRunStage(stageStates: StageStates, stageId: StageId): { allowed: boolean; reason?: string } {
  if (stageId === "brief") return { allowed: true };
  const prerequisite = getStagePrerequisite(stageId)!;
  if (stageStates[prerequisite].status !== "locked") {
    return { allowed: false, reason: `${STAGE_LABELS[prerequisite]}尚未锁定。` };
  }
  return { allowed: true };
}

export function lockStageInProject(project: GenerationProject, stageId: StageId, now = Date.now()): GenerationProject {
  const normalized = ensureStageWorkflow(project, now);
  if (stageId === "anchors") {
    const visualSetup = deriveVisualSetupStageState(normalized);
    if (!visualSetup.allItemsConfirmed) {
      throw new StageGateError("VISUAL_ANCHORS_INCOMPLETE", visualSetup.blockers.map((item) => item.title).join("；") || "人物与场景确认失败，请重试。");
    }
  }
  const current = normalized.stageStates![stageId];
  if (current.status !== "ready") {
    throw new StageGateError("STAGE_NOT_READY", `${STAGE_LABELS[stageId]}尚未达到可锁定状态。`);
  }
  const gate = canRunStage(normalized.stageStates!, stageId);
  if (!gate.allowed) {
    throw new StageGateError(prerequisiteErrorCode(stageId), gate.reason ?? "前置阶段尚未锁定。");
  }

  const resource = STAGE_RESOURCE[stageId];
  const resourceVersions = ensureCurrentResourceVersion(
    normalized.resourceVersions ?? [],
    resource.resourceId,
    resource.resourceType,
    snapshotForStage(normalized, stageId),
    now
  );
  const lockedVersion = currentResourceVersion(resourceVersions, resource.resourceId)?.version ?? 1;
  const stageStates: StageStates = {
    ...normalized.stageStates!,
    [stageId]: { status: "locked", updatedAt: now, lockedAt: now, lockedVersion }
  };
  const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(stageId) + 1];
  if (nextStage && stageStates[nextStage].status === "blocked") {
    const hasExistingOutput = stageHasOutput(normalized, nextStage);
    stageStates[nextStage] = { status: hasExistingOutput ? "ready" : "draft", updatedAt: now };
  }

  return {
    ...normalized,
    stageStates,
    resourceVersions,
    dependencyGraph: mergeDependencyGraph(normalized, resourceVersions)
  };
}

export function setStageStatusInProject(
  project: GenerationProject,
  stageId: StageId,
  status: Extract<StageState["status"], "draft" | "running" | "repairing" | "ready" | "failed">,
  now = Date.now(),
  errorCode?: string
): GenerationProject {
  const normalized = ensureStageWorkflow(project, now);
  if (status === "running" || status === "repairing" || status === "ready") {
    const gate = canRunStage(normalized.stageStates!, stageId);
    if (!gate.allowed) throw new StageGateError(prerequisiteErrorCode(stageId), gate.reason ?? "前置阶段尚未锁定。");
  }
  return {
    ...normalized,
    stageStates: {
      ...normalized.stageStates!,
      [stageId]: { status, updatedAt: now, ...(errorCode ? { errorCode } : {}) }
    }
  };
}

export function calculateDependencyImpact(
  graph: DependencyNode[],
  resourceId: string,
  currentVersion: number,
  nextVersion: number
): DependencyImpact {
  const affected = new Map<string, DependencyNode>();
  const queue: DependencyRef[] = [{ resourceId, version: currentVersion }];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const changed = queue[cursor]!;
    for (const node of graph) {
      const key = `${node.resourceId}:v${node.version}`;
      if (affected.has(key)) continue;
      if (!node.dependsOn.some((dependency) => dependency.resourceId === changed.resourceId && dependency.version === changed.version)) continue;
      affected.set(key, node);
      queue.push({ resourceId: node.resourceId, version: node.version });
    }
  }

  const nodes = [...affected.values()];
  return {
    resourceId,
    currentVersion,
    nextVersion,
    affectedStages: unique(nodes.map((node) => node.stageId)).sort(stageSort),
    affectedShotIds: unique(nodes.flatMap((node) => node.shotId ? [node.shotId] : [])),
    affectedFrameIds: unique(nodes.flatMap((node) => node.frameId ? [node.frameId] : [])),
    affectedVideoIds: unique(nodes.flatMap((node) => node.videoId ? [node.videoId] : [])),
    affectedNarrationIds: unique(nodes.flatMap((node) => node.narrationId ? [node.narrationId] : [])),
    finalAffected: nodes.some((node) => node.stageId === "final" || node.resourceType === "final")
  };
}

export function createResourceVersionInProject(
  project: GenerationProject,
  input: {
    resourceId: string;
    resourceType: VersionedResourceType;
    stageId: StageId;
    snapshot?: unknown;
    label?: string;
  },
  now = Date.now()
): { project: GenerationProject; impact: DependencyImpact; version: VersionedResource } {
  const normalized = ensureStageWorkflow(project, now);
  const current = currentResourceVersion(normalized.resourceVersions ?? [], input.resourceId);
  const currentVersion = current?.version ?? 0;
  const nextVersion = currentVersion + 1;
  const impact = calculateDependencyImpact(normalized.dependencyGraph ?? [], input.resourceId, currentVersion, nextVersion);
  const version: VersionedResource = {
    id: `${input.resourceId}:v${nextVersion}`,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
    version: nextVersion,
    createdAt: now,
    status: "current",
    ...(input.label ? { label: input.label } : {}),
    ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {})
  };
  const resourceVersions = [
    ...(normalized.resourceVersions ?? []).map((item) => item.resourceId === input.resourceId && item.status === "current"
      ? { ...item, status: "outdated" as const }
      : item),
    version
  ];
  const affectedKeys = new Set<string>();
  const sourceQueue: DependencyRef[] = currentVersion > 0 ? [{ resourceId: input.resourceId, version: currentVersion }] : [];
  for (let cursor = 0; cursor < sourceQueue.length; cursor += 1) {
    const source = sourceQueue[cursor]!;
    for (const node of normalized.dependencyGraph ?? []) {
      const key = `${node.resourceId}:v${node.version}`;
      if (affectedKeys.has(key)) continue;
      if (!node.dependsOn.some((dependency) => dependency.resourceId === source.resourceId && dependency.version === source.version)) continue;
      affectedKeys.add(key);
      sourceQueue.push({ resourceId: node.resourceId, version: node.version });
    }
  }
  const dependencyGraph = (normalized.dependencyGraph ?? []).map((node) => {
    const key = `${node.resourceId}:v${node.version}`;
    if (!affectedKeys.has(key)) return node;
    return {
      ...node,
      status: "outdated" as const,
      outdatedBecause: uniqueRefs([...(node.outdatedBecause ?? []), { resourceId: input.resourceId, version: currentVersion }])
    };
  });
  const stageStates = { ...normalized.stageStates! };
  for (const stageId of impact.affectedStages) {
    if (stageStates[stageId].status !== "blocked") stageStates[stageId] = { status: "outdated", updatedAt: now };
  }
  stageStates[input.stageId] = { status: "ready", updatedAt: now };

  return {
    project: { ...normalized, stageStates, resourceVersions, dependencyGraph },
    impact,
    version
  };
}

export function currentResourceVersion(resources: VersionedResource[], resourceId: string): VersionedResource | undefined {
  return resources
    .filter((item) => item.resourceId === resourceId && item.status === "current")
    .sort((left, right) => right.version - left.version)[0];
}

function seedResourceVersions(project: GenerationProject, stageStates: StageStates, now: number): VersionedResource[] {
  return STAGE_ORDER.flatMap((stageId) => {
    if (!stageHasOutput(project, stageId) && !["ready", "locked", "outdated"].includes(stageStates[stageId].status)) return [];
    const resource = STAGE_RESOURCE[stageId];
    return [{
      id: `${resource.resourceId}:v1`,
      resourceId: resource.resourceId,
      resourceType: resource.resourceType,
      version: 1,
      createdAt: now,
      status: "current" as const,
      label: `${STAGE_LABELS[stageId]} V1`,
      snapshot: snapshotForStage(project, stageId)
    }];
  });
}

function ensureCurrentResourceVersion(
  resources: VersionedResource[],
  resourceId: string,
  resourceType: VersionedResourceType,
  snapshot: unknown,
  now: number
): VersionedResource[] {
  if (currentResourceVersion(resources, resourceId)) return resources;
  const nextVersion = Math.max(0, ...resources.filter((item) => item.resourceId === resourceId).map((item) => item.version)) + 1;
  return [...resources, {
    id: `${resourceId}:v${nextVersion}`,
    resourceId,
    resourceType,
    version: nextVersion,
    createdAt: now,
    status: "current",
    snapshot
  }];
}

function mergeDependencyGraph(project: GenerationProject, versions: VersionedResource[]): DependencyNode[] {
  const existing = new Map((project.dependencyGraph ?? []).map((node) => [`${node.resourceId}:v${node.version}`, node]));
  const versionOf = (resourceId: string) => currentResourceVersion(versions, resourceId)?.version ?? 1;
  const currentRef = (resourceId: string) => currentResourceVersion(versions, resourceId)
    ? ref(resourceId, versionOf(resourceId))
    : null;
  const add = (node: DependencyNode) => {
    const key = `${node.resourceId}:v${node.version}`;
    const previous = existing.get(key);
    if (!previous) existing.set(key, node);
    else if (previous.status === "current") existing.set(key, {
      ...previous,
      dependsOn: uniqueRefs([...previous.dependsOn, ...node.dependsOn])
    });
  };

  add(node("creative-direction", "creative-direction", "creative", versionOf("creative-direction"), [ref("brief", versionOf("brief"))]));
  add(node("visual-anchors", "visual-anchors", "anchors", versionOf("visual-anchors"), [
    ref("brief", versionOf("brief")), ref("creative-direction", versionOf("creative-direction"))
  ]));
  add(node("storyboard", "storyboard", "storyboard", versionOf("storyboard"), [
    ref("brief", versionOf("brief")), ref("creative-direction", versionOf("creative-direction")), ref("visual-anchors", versionOf("visual-anchors"))
  ]));

  const productMaster = project.visualAnchorWorkspace?.productMaster;
  if (productMaster?.locked && productMaster.assetId) {
    add(node("product-master", "product-master", "anchors", versionOf("product-master"), [ref("brief", versionOf("brief"))]));
  }
  for (const spec of project.characterVisualSpecs ?? []) {
    if (!spec.locked || !currentMasterAssetId(spec)) continue;
    add(node(`character-master:${spec.id}`, "character-master", "anchors", versionOf(`character-master:${spec.id}`), [
      ref("creative-direction", versionOf("creative-direction"))
    ]));
  }
  for (const spec of project.sceneVisualSpecs ?? []) {
    if (!spec.locked || !currentMasterAssetId(spec)) continue;
    add(node(`scene-master:${spec.id}`, "scene-master", "anchors", versionOf(`scene-master:${spec.id}`), [
      ref("creative-direction", versionOf("creative-direction"))
    ]));
  }

  for (const shot of project.shots) {
    const masterDependencies = [
      ...(shot.containsProduct && productMaster?.locked ? [currentRef("product-master")] : []),
      ...(shot.characterIds ?? []).map((id) => currentRef(`character-master:${id}`)),
      ...(shot.sceneId ? [currentRef(`scene-master:${shot.sceneId}`)] : [])
    ].filter((item): item is DependencyRef => Boolean(item));
    for (const frame of shot.frames ?? []) {
      add({
        ...node(frame.id, "shot-frame", "keyframes", 1, [
          ref("storyboard", versionOf("storyboard")), ref("visual-anchors", versionOf("visual-anchors")), ...masterDependencies
        ]),
        shotId: shot.id,
        frameId: frame.id
      });
    }
  }

  if (project.heroVideo) {
    const shot = project.shots.find((item) => item.id === project.heroVideo?.shotId);
    const frame = shot?.frames?.find((item) => item.assetId === shot.primaryKeyframeAssetId) ?? shot?.frames?.[0];
    add({
      ...node(`shot-video:${project.heroVideo.shotId}`, "shot-video", "video", 1, [
        ref("storyboard", versionOf("storyboard")),
        ...(frame ? [ref(frame.id, 1)] : [])
      ]),
      shotId: project.heroVideo.shotId,
      videoId: project.heroVideo.assetId ?? `shot-video:${project.heroVideo.shotId}`
    });
  }
  for (const beat of project.narrationPlan?.beats ?? []) {
    add({
      ...node(`narration:${beat.id}`, "narration", "video", 1, [ref("storyboard", versionOf("storyboard"))]),
      shotId: beat.shotId,
      narrationId: beat.id
    });
  }
  if (project.finalVideo || project.finalVideoAssetId || project.finalVideoUrl) {
    add(node("final", "final", "final", versionOf("final"), [
      ref("storyboard", versionOf("storyboard")), ref("shot-videos", versionOf("shot-videos"))
    ]));
  }
  return [...existing.values()];
}

function node(
  resourceId: string,
  resourceType: VersionedResourceType,
  stageId: StageId,
  version: number,
  dependsOn: DependencyRef[]
): DependencyNode {
  return { resourceId, resourceType, stageId, version, status: "current", dependsOn };
}

function ref(resourceId: string, version: number): DependencyRef {
  return { resourceId, version };
}

function stageHasOutput(project: GenerationProject, stageId: StageId): boolean {
  if (stageId === "brief") return project.briefStatus === "saved";
  if (stageId === "creative") return ["completed", "fallback", "needs-review"].includes(project.workflowSteps?.strategy ?? "");
  if (stageId === "anchors") return ["completed", "fallback", "needs-review"].includes(project.workflowSteps?.strategy ?? "")
    && Boolean(project.referencePack || project.visualContinuityBible);
  if (stageId === "storyboard") return ["completed", "fallback", "needs-review"].includes(project.workflowSteps?.storyboard ?? "");
  if (stageId === "keyframes") return Boolean(project.keyframes?.length);
  if (stageId === "video") return Boolean(project.heroVideo || project.narrationAssetId);
  return Boolean(project.finalVideo || project.finalVideoAssetId || project.finalVideoUrl);
}

function snapshotForStage(project: GenerationProject, stageId: StageId): unknown {
  if (stageId === "brief") return { brief: project.brief, shotCount: project.shotCount, targetDurationSec: project.targetDurationSec };
  if (stageId === "creative") return { strategy: project.strategy, creativeBible: project.creativeBible };
  if (stageId === "anchors") return {
    productVisualSpec: project.productVisualSpec,
    characterVisualSpecs: project.characterVisualSpecs,
    sceneVisualSpecs: project.sceneVisualSpecs,
    visualAnchorWorkspace: project.visualAnchorWorkspace,
    visualContinuityBible: project.visualContinuityBible,
    referencePack: project.referencePack
  };
  if (stageId === "storyboard") return { shots: project.shots, narrationPlan: project.narrationPlan };
  if (stageId === "keyframes") return { keyframes: project.keyframes, keyframeQAResults: project.keyframeQAResults };
  if (stageId === "video") return { heroVideo: project.heroVideo, narrationAssetId: project.narrationAssetId, videoQAResults: project.videoQAResults };
  return { finalVideo: project.finalVideo, finalVideoAssetId: project.finalVideoAssetId };
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueRefs(values: DependencyRef[]): DependencyRef[] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.resourceId}:v${item.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stageSort(left: StageId, right: StageId): number {
  return STAGE_ORDER.indexOf(left) - STAGE_ORDER.indexOf(right);
}

function prerequisiteErrorCode(stageId: StageId): StageGateError["code"] {
  if (stageId === "creative") return "BRIEF_NOT_LOCKED";
  if (stageId === "anchors") return "CREATIVE_NOT_LOCKED";
  if (stageId === "storyboard") return "VISUAL_ANCHOR_NOT_LOCKED";
  if (stageId === "keyframes") return "STORYBOARD_NOT_LOCKED";
  return "STAGE_PREREQUISITE_NOT_LOCKED";
}
