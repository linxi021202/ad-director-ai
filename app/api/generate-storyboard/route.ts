import { z } from "zod";

import { diagnoseProviderFallback } from "../../../lib/api/provider-diagnostics";
import { markPrivateAssetsLifecycle } from "../../../lib/assets/assetStore";
import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { projectStoreErrorResponse } from "../../../lib/projects/api";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent } from "../../../lib/projects/generationEvents";
import {
  anonymousProjectIdSchema,
  replaceOwnedProjectShots,
  requireOwnedAnonymousProject,
  updateOwnedAnonymousProject
} from "../../../lib/projects/anonymousProjectStore";
import { generateStoryboard, selectProviderModel } from "../../../lib/providers/providerRouter";
import { adStrategySchema, productBriefSchema, type GenerationProject } from "../../../lib/schemas/project";
import { getAnonymousApiSession } from "../../../lib/session/api";
import { MAX_SHOT_COUNT, MAX_SHOT_DURATION_SEC, MIN_SHOT_COUNT, MIN_SHOT_DURATION_SEC, resolveShotPlan } from "../../../lib/video/shotConfig";

const requestSchema = z.object({
  projectId: anonymousProjectIdSchema,
  brief: productBriefSchema,
  strategy: adStrategySchema,
  requestedShotCount: z.number().int().min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT).optional(),
  targetDurationSec: z.number().int().min(12).max(60).optional(),
  shotDurationPlan: z.array(z.number().int().min(MIN_SHOT_DURATION_SEC).max(MAX_SHOT_DURATION_SEC)).min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT).optional(),
  regenerateExisting: z.boolean().optional()
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
      return apiJson({ success: false, data: null, trace: { route: "generate-storyboard", stage: "validation" }, fallbackUsed: false, error: "项目 ID、商品简报或策略无效。" }, 400);
    }
    projectId = parsed.data.projectId;
    const owned = await requireOwnedAnonymousProject(session.id, projectId);
    const timeline = resolveShotPlan(
      parsed.data.requestedShotCount ?? owned.project.shotCount,
      parsed.data.shotDurationPlan ?? owned.project.shots.map((shot) => shot.durationSec),
      parsed.data.targetDurationSec ?? owned.project.targetDurationSec ?? parsed.data.brief.durationSec
    );
    if (timeline.shotDurationPlan.length !== timeline.shotCount) {
      return apiJson({ success: false, data: null, trace: { route: "generate-storyboard", stage: "shot-config" }, fallbackUsed: false, error: "镜头时长计划与分镜数量不一致。" }, 400);
    }
    const event = await startGenerationEvent(session.id, projectId, {
      stage: "storyboard", provider: "deepseek", action: "生成分镜脚本", message: "DeepSeek 正在生成分镜脚本与镜头结构。"
    });
    eventId = event.id;

    const route = selectProviderModel({ taskType: "storyboard" });
    const result = await generateStoryboard(parsed.data.brief, parsed.data.strategy, {
      sessionId: session.id,
      requestedShotCount: timeline.shotCount,
      targetDurationSec: timeline.targetDurationSec,
      shotDurationPlan: timeline.shotDurationPlan
    });
    if (result.data) {
      const invalidatedAssetIds = parsed.data.regenerateExisting
        ? collectTimelineAssetIds(owned.project)
        : [];
      await replaceOwnedProjectShots(session.id, projectId, result.data, undefined, {
        invalidateExistingAssets: parsed.data.regenerateExisting === true
      });
      await markPrivateAssetsLifecycle(session.id, projectId, invalidatedAssetIds, "orphaned");
      const current = await requireOwnedAnonymousProject(session.id, projectId);
      await updateOwnedAnonymousProject(session.id, projectId, {
        strategy: parsed.data.strategy,
        targetDurationSec: timeline.targetDurationSec,
        brief: { ...parsed.data.brief, durationSec: timeline.targetDurationSec },
        workflowSteps: {
          ...(current.project.workflowSteps ?? defaultWorkflow()),
          brief: "completed", strategy: "completed", storyboard: result.fallbackUsed ? "fallback" : "completed"
        }
      });
      await completeGenerationEvent(session.id, projectId, eventId,
        result.fallbackUsed ? "分镜生成失败，已使用本地模板继续。" : `分镜生成完成，共 ${result.data.length} 个镜头。`,
        { status: result.fallbackUsed ? "fallback" : "completed", latencyMs: result.latencyMs, progressCurrent: result.data.length, progressTotal: result.data.length }
      );
    } else {
      await failGenerationEvent(session.id, projectId, eventId, "分镜生成失败，请检查模型配置后重试。");
    }

    return apiJson({
      success: result.success,
      data: result.data ? { shots: result.data } : null,
      trace: {
        route: "generate-storyboard", taskType: "storyboard", provider: result.provider, model: result.model,
        latencyMs: result.latencyMs, tokenUsage: result.tokenUsage, costEstimate: result.costEstimate,
        plannedRoute: route,
        diagnostic: result.fallbackUsed || result.error ? diagnoseProviderFallback(result.fallbackReason ?? result.error) : null
      },
      fallbackUsed: result.fallbackUsed,
      fallbackReason: result.fallbackReason,
      error: result.error
    });
  } catch (error) {
    if (eventId && projectId) await failGenerationEvent(session.id, projectId, eventId, "分镜生成失败，请稍后重试。").catch(() => undefined);
    const projectError = projectStoreErrorResponse(error);
    if (projectError) return projectError;
    return apiJson({ success: false, data: null, trace: { route: "generate-storyboard", stage: "exception" }, fallbackUsed: false, error: sanitizeApiError(error) }, 500);
  }
}

function collectTimelineAssetIds(project: GenerationProject): string[] {
  return Array.from(new Set([
    ...(project.keyframes ?? []).map((keyframe) => keyframe.assetId),
    project.heroVideo?.assetId,
    project.finalVideo?.assetId,
    project.narrationAssetId,
    project.finalVideoAssetId
  ].filter((assetId): assetId is string => Boolean(assetId))));
}
function defaultWorkflow() {
  return {
    brief: "completed" as const, strategy: "pending" as const, storyboard: "pending" as const,
    keyframes: "pending" as const, heroShot: "pending" as const, render: "pending" as const
  };
}
