import type { GenerationProject } from "../schemas/project";
import { getVisualAnchorReadiness } from "./visualAnchors";

export type VisualItemStatus = "not-started" | "ready" | "selected" | "confirmed";
export type VisualSetupStageStatus = "not-started" | "in-progress" | "ready-to-complete" | "completed" | "outdated";

export type VisualSetupBlocker = {
  key: "product" | "character" | "scene";
  title: string;
  description: string;
};

export type VisualSetupStageState = {
  status: VisualSetupStageStatus;
  allItemsConfirmed: boolean;
  productConfirmed: boolean;
  characterConfirmed: boolean;
  scenesConfirmed: boolean;
  productStatus: VisualItemStatus;
  characterStatuses: Array<{ id: string; status: VisualItemStatus }>;
  sceneStatuses: Array<{ id: string; status: VisualItemStatus }>;
  blockers: VisualSetupBlocker[];
};

export function deriveVisualSetupStageState(project: GenerationProject): VisualSetupStageState {
  const readiness = getVisualAnchorReadiness(project);
  const workspace = project.visualAnchorWorkspace;
  const requiredCharacterIds = workspace?.requiredCharacterIds ?? project.characterVisualSpecs?.map((item) => item.id) ?? [];
  const requiredSceneIds = workspace?.requiredSceneIds ?? project.sceneVisualSpecs?.map((item) => item.id) ?? [];
  const missingCharacters = new Set(readiness.missingCharacterIds);
  const missingScenes = new Set(readiness.missingSceneIds);
  const productConfirmed = readiness.productLocked;
  const characterConfirmed = readiness.missingCharacterIds.length === 0;
  const scenesConfirmed = readiness.missingSceneIds.length === 0;
  const allItemsConfirmed = productConfirmed && characterConfirmed && scenesConfirmed;
  const storedStatus = project.stageStates?.anchors.status;
  const legacyCompleted = storedStatus === "locked" && !workspace && Boolean(project.referencePack || project.visualContinuityBible);

  let status: VisualSetupStageStatus;
  if (storedStatus === "locked" && (allItemsConfirmed || legacyCompleted)) status = "completed";
  else if (storedStatus === "locked" || storedStatus === "outdated") status = "outdated";
  else if (allItemsConfirmed) status = "ready-to-complete";
  else if (!workspace && (!storedStatus || storedStatus === "blocked" || storedStatus === "draft")) status = "not-started";
  else status = "in-progress";

  return {
    status,
    allItemsConfirmed: allItemsConfirmed || legacyCompleted,
    productConfirmed: productConfirmed || legacyCompleted,
    characterConfirmed: characterConfirmed || legacyCompleted,
    scenesConfirmed: scenesConfirmed || legacyCompleted,
    productStatus: productConfirmed || legacyCompleted ? "confirmed" : workspace?.productMaster.assetId ? "ready" : "not-started",
    characterStatuses: requiredCharacterIds.map((id) => ({ id, status: itemStatus(project, "character", id, !missingCharacters.has(id) || legacyCompleted) })),
    sceneStatuses: requiredSceneIds.map((id) => ({ id, status: itemStatus(project, "scene", id, !missingScenes.has(id) || legacyCompleted) })),
    blockers: legacyCompleted ? [] : getVisualSetupBlockers(project)
  };
}

export function getVisualSetupBlockers(project: GenerationProject): VisualSetupBlocker[] {
  const readiness = getVisualAnchorReadiness(project);
  const blockers: VisualSetupBlocker[] = [];
  if (!readiness.productLocked) {
    blockers.push({ key: "product", title: "还需要确认产品", description: "请先确认当前真实产品图片。" });
  }
  if (readiness.missingCharacterIds.length) {
    blockers.push({ key: "character", title: "还需要确认主角", description: `还有 ${readiness.missingCharacterIds.length} 个主角需要选择并确认。` });
  }
  if (readiness.missingSceneIds.length) {
    blockers.push({ key: "scene", title: "还需要确认场景", description: `还有 ${readiness.missingSceneIds.length} 个主要场景需要选择并确认。` });
  }
  return blockers;
}

export function canEnterStoryboard(project: GenerationProject): boolean {
  return deriveVisualSetupStageState(project).status === "completed"
    && project.stageStates?.creative.status === "locked";
}

export function visualSetupStatusLabel(status: VisualSetupStageStatus): string {
  return {
    "not-started": "未开始",
    "in-progress": "进行中",
    "ready-to-complete": "可以继续",
    completed: "已完成",
    outdated: "需要重新确认"
  }[status];
}

function itemStatus(project: GenerationProject, kind: "character" | "scene", targetId: string, confirmed: boolean): VisualItemStatus {
  if (confirmed) return "confirmed";
  const selection = project.visualAnchorWorkspace?.[kind === "character" ? "characterSelections" : "sceneSelections"]
    ?.find((item) => item.targetId === targetId);
  if (selection?.selectedCandidateId) return "selected";
  const candidates = project.visualAnchorWorkspace?.[kind === "character" ? "characterCandidates" : "sceneCandidates"] ?? [];
  return candidates.some((item) => item.targetId === targetId && item.status !== "outdated") ? "ready" : "not-started";
}
