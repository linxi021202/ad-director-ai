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
import { generatePrompts, selectProviderModel } from "../../../lib/providers/providerRouter";
import { adStrategySchema, productBriefSchema, storyboardShotSchema } from "../../../lib/schemas/project";
import { getAnonymousApiSession } from "../../../lib/session/api";

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
    await requireOwnedAnonymousProject(session.id, projectId);
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
    const result = await generatePrompts(parsed.data.brief, parsed.data.strategy, parsed.data.shots, { sessionId: session.id });
    let shots = result.data ?? [];

    if (shots.length > 0) {
      await replaceOwnedProjectShots(session.id, projectId, shots);
      const current = await requireOwnedAnonymousProject(session.id, projectId);
      const updated = await updateOwnedAnonymousProject(session.id, projectId, {
        workflowSteps: {
          ...(current.project.workflowSteps ?? defaultWorkflow()),
          storyboard: result.fallbackUsed ? "fallback" : "completed"
        }
      });
      shots = updated.project.shots;
    }

    if (!result.success && !result.fallbackUsed) {
      await failGenerationEvent(session.id, projectId, event.id, "提示词生成失败，请检查模型配置后重试。");
    } else {
      await completeGenerationEvent(
        session.id,
        projectId,
        event.id,
        result.fallbackUsed ? "真实提示词生成失败，已保留模板提示词。" : `已完成 ${shots.length} 个镜头的图片与视频提示词。`,
        { status: result.fallbackUsed ? "fallback" : "completed", latencyMs: result.latencyMs, progressCurrent: shots.length, progressTotal: parsed.data.shots.length }
      );
    }

    const plannedAssets = shots.map((shot) => ({
      shotId: shot.id,
      index: shot.index,
      imagePromptCn: shot.imagePromptCn,
      imagePromptEn: shot.imagePromptEn,
      videoPromptCn: shot.videoPromptCn,
      recommendedModel: shot.recommendedModel,
      fallbackPlan: shot.fallbackPlan,
      imageProvider: imageRoute.model,
      videoProvider: shot.recommendedModel === "wan2.7-r2v" ? videoRoute.model : "remotion-image-motion",
      status: "planned"
    }));

    return apiJson({
      success: result.success,
      data: result.success ? { shots, plannedAssets } : null,
      trace: {
        route: "generate-assets",
        taskType: "prompt",
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        tokenUsage: result.tokenUsage,
        imageProvider: imageRoute.model,
        videoProvider: videoRoute.model,
        realImageCalled: false,
        realVideoCalled: false
      },
      fallbackUsed: result.fallbackUsed,
      fallbackReason: result.fallbackReason ?? null,
      error: result.error ?? null
    }, result.success ? 200 : 502);
  } catch (error) {
    if (eventId && projectId) {
      await failGenerationEvent(session.id, projectId, eventId, "提示词生成失败，请检查模型配置后重试。").catch(() => undefined);
    }
    const projectError = projectStoreErrorResponse(error);
    if (projectError) return projectError;
    return apiJson({ success: false, data: null, trace: { route: "generate-assets", stage: "exception" }, fallbackUsed: false, error: sanitizeApiError(error) }, 500);
  }
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
