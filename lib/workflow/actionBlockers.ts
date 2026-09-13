import type { GenerationProject } from "../schemas/project";
import { getVisualAnchorReadiness } from "../visual/visualAnchors";

export type WorkflowAction =
  | "CONFIRM_PRODUCT" | "GENERATE_CHARACTER" | "CONFIRM_CHARACTER" | "GENERATE_SCENE" | "CONFIRM_SCENE"
  | "CONFIRM_VISUAL_SETUP" | "GENERATE_STORYBOARD" | "CONFIRM_STORYBOARD" | "GENERATE_KEYFRAME"
  | "GENERATE_VIDEO" | "GENERATE_FINAL";

export type ActionBlocker = { title: string; description: string; targetAction?: { label: string; href: string } };

export function getActionBlockers(project: GenerationProject, action: WorkflowAction): ActionBlocker[] {
  const projectHref = `/generate?projectId=${encodeURIComponent(project.id)}`;
  const productExists = Boolean(project.brief.productImages?.some((image) => image.role !== "logo" && image.assetId));
  const readiness = getVisualAnchorReadiness(project);
  const blockers: ActionBlocker[] = [];

  if (["CONFIRM_PRODUCT", "GENERATE_CHARACTER", "GENERATE_SCENE", "CONFIRM_VISUAL_SETUP"].includes(action) && !productExists) {
    blockers.push({ title: "还没有真实产品图", description: "请先上传并保存一张清晰的产品原图。外观分析未完成不会阻止确认。", targetAction: { label: "去上传产品图", href: `${projectHref}&stage=brief#product-assets-title` } });
  }
  if (["GENERATE_CHARACTER", "GENERATE_SCENE", "CONFIRM_VISUAL_SETUP", "GENERATE_STORYBOARD"].includes(action) && project.stageStates?.creative.status !== "locked") {
    blockers.push({ title: "创意方向尚未确认", description: "选择并确认一套创意后，系统才能确定需要哪些人物和场景。", targetAction: { label: "去选择创意", href: `${projectHref}&stage=creative` } });
  }
  if (["CONFIRM_CHARACTER", "CONFIRM_VISUAL_SETUP"].includes(action) && readiness.missingCharacterIds.length) {
    blockers.push({ title: "主角尚未选择", description: `还有 ${readiness.missingCharacterIds.length} 个主角需要选择候选方案。`, targetAction: { label: "去选择主角", href: `${projectHref}&stage=anchors#anchor-characters` } });
  }
  if (["CONFIRM_SCENE", "CONFIRM_VISUAL_SETUP"].includes(action) && readiness.missingSceneIds.length) {
    blockers.push({ title: "主要场景尚未确认", description: `还有 ${readiness.missingSceneIds.length} 个场景需要选择候选方案。`, targetAction: { label: "去确认场景", href: `${projectHref}&stage=anchors#anchor-scenes` } });
  }
  if (["GENERATE_STORYBOARD"].includes(action) && project.stageStates?.anchors.status !== "locked") {
    blockers.push({ title: "人物与场景尚未确认", description: "确认产品、主角和主要场景后才能制作文字分镜。", targetAction: { label: "去完成人物与场景", href: `${projectHref}&stage=anchors` } });
  }
  if (["CONFIRM_STORYBOARD", "GENERATE_KEYFRAME"].includes(action) && !["ready", "locked"].includes(project.stageStates?.storyboard.status ?? "draft")) {
    blockers.push({ title: "文字分镜尚未完成", description: "请先生成并检查文字分镜。", targetAction: { label: "去查看文字分镜", href: `${projectHref}&stage=storyboard` } });
  }
  if (action === "GENERATE_VIDEO" && !project.shots.some((shot) => shot.frames?.some((frame) => frame.isLocked))) {
    blockers.push({ title: "关键帧尚未确认", description: "视频生成需要至少一个已经确认的完整关键帧。", targetAction: { label: "去生成关键帧", href: `${projectHref}&stage=keyframes` } });
  }
  if (action === "GENERATE_FINAL" && !project.heroVideo) {
    blockers.push({ title: "镜头视频尚未完成", description: "请先生成并确认需要的视频镜头。", targetAction: { label: "去生成视频", href: `${projectHref}&stage=video` } });
  }
  return blockers;
}
