import { z } from "zod";

import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { projectStoreErrorResponse } from "../../../lib/projects/api";
import {
  anonymousProjectIdSchema,
  replaceOwnedProjectShots,
  requireOwnedAnonymousProject,
  updateOwnedAnonymousProject
} from "../../../lib/projects/anonymousProjectStore";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent } from "../../../lib/projects/generationEvents";
import { selectProviderModel } from "../../../lib/providers/providerRouter";
import { expandShotPrompts } from "../../../lib/providers/deepseekProvider";
import { reviewDetailedPromptPackage } from "../../../lib/director/promptQualityReview";
import { adStrategySchema, productBriefSchema, storyboardShotSchema, type DetailedShotPromptPackage, type StoryboardShot } from "../../../lib/schemas/project";
import { getAnonymousApiSession } from "../../../lib/session/api";
import { resolveProjectProductVisualSpec } from "../../../lib/visual/productVisualSpec";

const requestSchema = z.object({
  projectId: anonymousProjectIdSchema,
  brief: productBriefSchema,
  strategy: adStrategySchema,
  shots: z.array(storyboardShotSchema).min(1).max(12)
}).strict();

export async function POST(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  let eventId: string | undefined;
  let projectId: string | undefined;

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiJson({ success: false, data: null, trace: { route: "generate-assets", stage: "validation" }, fallbackUsed: false, error: "项目 ID 或提示词生成输入无效。" }, 400);
    }

    projectId = parsed.data.projectId;
    const owned = await requireOwnedAnonymousProject(session.id, projectId);
    const productSpec = await resolveProjectProductVisualSpec({ sessionId: session.id, project: owned.project });
    const event = await startGenerationEvent(session.id, projectId, {
      stage: "prompts",
      provider: "deepseek",
      action: "生成镜头提示词",
      message: `DeepSeek 正在为 ${parsed.data.shots.length} 个镜头完善图片与视频提示词。`,
      progressCurrent: 0,
      progressTotal: parsed.data.shots.length
    });
    eventId = event.id;

    const promptRoute = selectProviderModel({ taskType: "prompt" });
    const imageRoute = selectProviderModel({ taskType: "image", hasChineseText: true });
    const videoRoute = selectProviderModel({ taskType: "video", isHeroShot: true });
    if (process.env.AI_MODE !== "real") {
      const shots = owned.project.shots;
      const plannedAssets = buildPlannedAssets(shots, imageRoute.model, videoRoute.model);
      await completeGenerationEvent(session.id, projectId, event.id, `演示模式已规划 ${shots.length} 个镜头的提示词扩写。`, {
        status: "completed", latencyMs: 0, progressCurrent: shots.length, progressTotal: shots.length
      });
      return apiJson({
        success: true,
        data: { shots, plannedAssets, promptPackages: owned.project.shotPromptPackages ?? [], failures: [] },
        trace: { route: "generate-assets", taskType: "prompt", provider: promptRoute.provider, model: promptRoute.model, latencyMs: 0, imageProvider: imageRoute.model, videoProvider: videoRoute.model, realImageCalled: false, realVideoCalled: false },
        fallbackUsed: false,
        fallbackReason: null,
        error: null
      });
    }
    const sourceShots = owned.project.shots.filter((shot) => parsed.data.shots.some((requested) => requested.id === shot.id));
    const packages: DetailedShotPromptPackage[] = [];
    const failures: string[] = [];
    let totalLatencyMs = 0;
    for (const shot of sourceShots) {
      const result = await expandShotPrompts({
        brief: owned.project.brief,
        strategy: owned.project.strategy,
        shot,
        previousShot: owned.project.shots.find((candidate) => candidate.index === shot.index - 1),
        productVisualSpec: productSpec.spec,
        visualContinuityBible: owned.project.visualContinuityBible,
        referencePack: owned.project.referencePack
      }, { sessionId: session.id });
      totalLatencyMs += result.latencyMs;
      if (result.success && result.data) {
        const review = reviewDetailedPromptPackage(result.data);
        if (review.passed) packages.push(result.data);
        else failures.push(`镜头 ${shot.index}：质量审查未通过（${review.issues.join("、")}）`);
      } else failures.push(`镜头 ${shot.index}：${result.error ?? "生成失败"}`);
    }
    let shots = owned.project.shots.map((shot) => {
      const promptPackage = packages.find((item) => item.shotId === shot.id);
      return promptPackage ? applyPromptPackage(shot, promptPackage) : shot;
    });

    if (packages.length > 0) {
      await replaceOwnedProjectShots(session.id, projectId, shots);
      const current = await requireOwnedAnonymousProject(session.id, projectId);
      const packageByShot = new Map([...(current.project.shotPromptPackages ?? []), ...packages].map((item) => [item.shotId, item]));
      const updated = await updateOwnedAnonymousProject(session.id, projectId, {
        ...(productSpec.spec ? { productVisualSpec: productSpec.spec } : {}),
        shotPromptPackages: [...packageByShot.values()],
        workflowSteps: {
          ...(current.project.workflowSteps ?? defaultWorkflow()),
          storyboard: failures.length ? "needs-review" : "completed"
        }
      });
      shots = updated.project.shots;
    }

    if (failures.length) {
      await failGenerationEvent(session.id, projectId, event.id, `已有 ${packages.length} 个镜头完成，${failures.length} 个镜头需要重试。`, "PROMPT_EXPANSION_PARTIAL_FAILURE");
    } else {
      await completeGenerationEvent(
        session.id,
        projectId,
        event.id,
        `已完成 ${packages.length} 个镜头的详细图片与视频提示词。`,
        { status: "completed", latencyMs: totalLatencyMs, progressCurrent: packages.length, progressTotal: sourceShots.length }
      );
    }

    const plannedAssets = buildPlannedAssets(shots, imageRoute.model, videoRoute.model);

    return apiJson({
      success: failures.length === 0,
      data: packages.length ? { shots, plannedAssets, promptPackages: packages, failures } : null,
      trace: {
        route: "generate-assets",
        taskType: "prompt",
        provider: "deepseek",
        model: promptRoute.model,
        latencyMs: totalLatencyMs,
        imageProvider: imageRoute.model,
        videoProvider: videoRoute.model,
        realImageCalled: false,
        realVideoCalled: false
      },
      fallbackUsed: false,
      fallbackReason: null,
      error: failures.length ? failures.join("；") : null
    }, failures.length ? 207 : 200);
  } catch (error) {
    if (eventId && projectId) {
      await failGenerationEvent(session.id, projectId, eventId, "提示词生成失败，请检查模型配置后重试。").catch(() => undefined);
    }
    const projectError = projectStoreErrorResponse(error);
    if (projectError) return projectError;
    return apiJson({ success: false, data: null, trace: { route: "generate-assets", stage: "exception" }, fallbackUsed: false, error: sanitizeApiError(error) }, 500);
  }
}

function buildPlannedAssets(shots: StoryboardShot[], imageModel: string, videoModel: string) {
  return shots.map((shot) => ({
    shotId: shot.id, index: shot.index, imagePromptCn: shot.imagePromptCn, imagePromptEn: shot.imagePromptEn,
    videoPromptCn: shot.videoPromptCn, recommendedModel: shot.recommendedModel, fallbackPlan: shot.fallbackPlan,
    imageProvider: imageModel, videoProvider: /wan2\.7-(?:i2v|r2v)/i.test(shot.recommendedModel) ? videoModel : "remotion-image-motion", status: "planned"
  }));
}

function applyPromptPackage(shot: StoryboardShot, promptPackage: DetailedShotPromptPackage): StoryboardShot {
  const firstFrame = promptPackage.framePrompts[0];
  return {
    ...shot,
    imagePromptCn: firstFrame?.imagePromptCn ?? shot.imagePromptCn,
    imagePromptEn: firstFrame?.imagePromptEn ?? shot.imagePromptEn,
    videoPromptCn: promptPackage.videoPromptCn,
    videoPromptEn: promptPackage.videoPromptEn,
    negativePromptCn: promptPackage.negativePromptCn,
    negativePromptEn: promptPackage.negativePromptEn,
    continuityConstraints: promptPackage.continuityContext.immutableElements,
    textSafeZone: shot.textSafeZone,
    frames: shot.frames?.map((frame, index) => {
      const expanded = promptPackage.framePrompts.find((item) => item.frameId === frame.id) ?? promptPackage.framePrompts[index];
      return expanded ? { ...frame, imagePromptCn: expanded.imagePromptCn, imagePromptEn: expanded.imagePromptEn, negativePromptCn: expanded.negativePromptCn, negativePromptEn: expanded.negativePromptEn } : frame;
    })
  };
}

function defaultWorkflow() {
  return {
    brief: "completed" as const,
    strategy: "completed" as const,
    storyboard: "completed" as const,
    keyframes: "pending" as const,
    heroShot: "pending" as const,
    render: "pending" as const
  };
}
