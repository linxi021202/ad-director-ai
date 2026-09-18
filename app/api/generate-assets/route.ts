import { z } from "zod";

import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { projectStoreErrorResponse } from "../../../lib/projects/api";
import {
  anonymousProjectIdSchema,
  replaceOwnedProjectShots,
  requireOwnedAnonymousProject,
  updateOwnedAnonymousProject
} from "../../../lib/projects/anonymousProjectStore";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent, updateGenerationEventProgress } from "../../../lib/projects/generationEvents";
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
    const completedShotIds = new Set((owned.project.shotPromptPackages ?? []).map((item) => item.shotId));
    const sourceShots = owned.project.shots.filter((shot) =>
      parsed.data.shots.some((requested) => requested.id === shot.id) && !completedShotIds.has(shot.id)
    );
    const packages: DetailedShotPromptPackage[] = [];
    const failures: string[] = [];
    let totalLatencyMs = 0;
    for (const [shotOffset, shot] of sourceShots.entries()) {
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
        if (review.passed) {
          packages.push(result.data);
          await persistPromptPackage(session.id, projectId, result.data);
        } else failures.push(`镜头 ${shot.index}：详细提示词未通过完整性检查，请单独重试。`);
      } else failures.push(`镜头 ${shot.index}：${promptExpansionPublicError(result.error)}`);
      await updateGenerationEventProgress(
        session.id,
        projectId,
        event.id,
        shotOffset + 1,
        sourceShots.length,
        failures.length
          ? `正在继续处理剩余镜头，已完成 ${packages.length} 个，${failures.length} 个等待重试。`
          : `已完成 ${packages.length} / ${sourceShots.length} 个镜头的详细提示词。`
      );
    }
    let shots = (await requireOwnedAnonymousProject(session.id, projectId)).project.shots;

    if (packages.length > 0) {
      const current = await requireOwnedAnonymousProject(session.id, projectId);
      const updated = await updateOwnedAnonymousProject(session.id, projectId, {
        ...(productSpec.spec ? { productVisualSpec: productSpec.spec } : {}),
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
      error: failures.length ? `${failures.length} 个镜头的详细提示词尚未完成，已保留成功结果。请重试当前步骤。` : null
    }, failures.length ? 207 : 200);
  } catch (error) {
    if (eventId && projectId) {
      await failGenerationEvent(session.id, projectId, eventId, "提示词生成失败，请检查模型配置后重试。").catch(() => undefined);
    }
    const projectError = projectStoreErrorResponse(error);
    if (projectError) return projectError;
    return apiJson({ success: false, data: null, trace: { route: "generate-assets", stage: "exception" }, fallbackUsed: false, error: promptExpansionPublicError(sanitizeApiError(error)) }, 500);
  }
}

async function persistPromptPackage(sessionId: string, projectId: string, promptPackage: DetailedShotPromptPackage) {
  const current = await requireOwnedAnonymousProject(sessionId, projectId);
  const shots = current.project.shots.map((shot) => shot.id === promptPackage.shotId ? applyPromptPackage(shot, promptPackage) : shot);
  await replaceOwnedProjectShots(sessionId, projectId, shots);
  const refreshed = await requireOwnedAnonymousProject(sessionId, projectId);
  const packageByShot = new Map([...(refreshed.project.shotPromptPackages ?? []), promptPackage].map((item) => [item.shotId, item]));
  await updateOwnedAnonymousProject(sessionId, projectId, { shotPromptPackages: [...packageByShot.values()] });
}

function promptExpansionPublicError(error?: string | null) {
  if (/DEEPSEEK_OUTPUT_TRUNCATED|输出达到长度上限/i.test(error ?? "")) {
    return "该镜头内容较长，系统拆分生成后仍未完整返回，请单独重试。";
  }
  if (/DEEPSEEK_(?:AUTH_FAILED|QUOTA_EXHAUSTED|RATE_LIMITED|NETWORK_ERROR|TIMEOUT|UPSTREAM_ERROR)/i.test(error ?? "")) {
    return "DeepSeek 暂时未能完成该镜头，请稍后重试。";
  }
  if (/MODEL_SCHEMA_DRIFT|Zod|unrecognized_keys|PROMPT_|VAGUE_|FRAME_|SHOT_/i.test(error ?? "")) {
    return "该镜头的详细提示词结构不完整，请单独重试。";
  }
  return "该镜头的详细提示词生成失败，请稍后重试。";
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
