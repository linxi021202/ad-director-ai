import { detailedShotPromptPackageSchema, type GenerationProject, type StoryboardShot } from "../schemas/project";
import { reviewDetailedPromptPackage } from "../director/promptQualityReview";
import { matchesShotPromptInputFingerprint } from "./shotPromptFingerprint";
import { ensureShotArchitecture } from "../storyboard/shotArchitecture";
import { validateDetailedKeyframePlan } from "../storyboard/keyframePlan";

export function isShotPromptReady(project: GenerationProject, shot: StoryboardShot) {
  const parsed = detailedShotPromptPackageSchema.safeParse(project.shotPromptPackages?.find((item) => item.shotId === shot.id));
  if (!parsed.success || parsed.data.schemaVersion !== 2) return false;
  const fingerprintMatches = matchesShotPromptInputFingerprint(parsed.data.inputFingerprint, { brief: project.brief, strategy: project.strategy, shot,
    previousShot: project.shots.find((item) => item.index === shot.index - 1), productVisualSpec: project.productVisualSpec,
    visualContinuityBible: project.visualContinuityBible, referencePack: project.referencePack });
  return fingerprintMatches && reviewDetailedPromptPackage(parsed.data).passed
    && validateDetailedKeyframePlan(ensureShotArchitecture(shot), parsed.data.framePrompts).passed;
}
