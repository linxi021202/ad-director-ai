import type { GenerationProject } from "../schemas/project";

export type CreativeStageStatus = "not-started" | "generated" | "selected" | "confirmed" | "outdated";

export function deriveCreativeStageState(project: GenerationProject) {
  const set = project.creativeWorkspace?.sets.find((item) => item.id === project.creativeWorkspace?.currentSetId);
  const stageStatus = project.stageStates?.creative.status;
  const confirmed = Boolean(set?.confirmedCandidateId && stageStatus === "locked");
  const status: CreativeStageStatus = stageStatus === "outdated"
    ? "outdated"
    : confirmed ? "confirmed"
      : set?.selectedCandidateId ? "selected"
        : set ? "generated" : "not-started";
  return { status, set, selectedCandidateId: set?.selectedCandidateId, confirmedCandidateId: confirmed ? set?.confirmedCandidateId : undefined };
}

export function creativeStageStatusLabel(status: CreativeStageStatus) {
  return ({ "not-started": "未开始", generated: "等待选择", selected: "已选择", confirmed: "已确认", outdated: "需要更新" } as const)[status];
}
