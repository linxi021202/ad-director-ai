import { z } from "zod";

import { markPrivateAssetsLifecycle } from "../../../lib/assets/assetStore";
import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { projectStoreErrorResponse } from "../../../lib/projects/api";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent, updateGenerationEventProgress } from "../../../lib/projects/generationEvents";
import {
  anonymousProjectIdSchema,
  replaceOwnedProjectShots,
  requireOwnedAnonymousProject,
  saveOwnedStoryboardChunk,
  updateOwnedAnonymousProject
} from "../../../lib/projects/anonymousProjectStore";
import { generateStoryboard as generateRoutedStoryboard, selectProviderModel } from "../../../lib/providers/providerRouter";
import { deepseekProvider, generateNarrationPlan } from "../../../lib/providers/deepseekProvider";
import { buildPartialNarrationPlan } from "../../../lib/audio/narrationPlan";
import { adStrategySchema, productBriefSchema, type GenerationProject } from "../../../lib/schemas/project";
import { getAnonymousApiSession } from "../../../lib/session/api";
import { MAX_SHOT_COUNT, MAX_SHOT_DURATION_SEC, MIN_SHOT_COUNT, MIN_SHOT_DURATION_SEC, resolveShotPlan } from "../../../lib/video/shotConfig";
import { resolveProjectProductVisualSpec } from "../../../lib/visual/productVisualSpec";
import { assertStoryboardMatchesPlanning, planningDurationPlan, resolveProjectPlanningConstraints } from "../../../lib/projects/planningConstraints";

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
      return apiJson({ success: false, data: null, trace: { route: "generate-storyboard", stage: "validation" }, fallbackUsed: false, error: "项目 ID、广告需求或策略无效。" }, 400);
    }
    projectId = parsed.data.projectId;
    const owned = await requireOwnedAnonymousProject(session.id, projectId);
    const productSpec = await resolveProjectProductVisualSpec({ sessionId: session.id, project: owned.project });
    const constraints = resolveProjectPlanningConstraints(owned.project);
    const timeline = resolveShotPlan(constraints.shotCount, planningDurationPlan(owned.project), constraints.targetDurationSec);
    if (timeline.shotDurationPlan.length !== timeline.shotCount) {
      return apiJson({ success: false, data: null, trace: { route: "generate-storyboard", stage: "shot-config" }, fallbackUsed: false, error: "镜头时长计划与分镜数量不一致。" }, 400);
    }
    const event = await startGenerationEvent(session.id, projectId, {
      stage: "storyboard", provider: "deepseek", action: "生成分镜脚本", message: "DeepSeek 正在生成分镜脚本与镜头结构。"
    });
    eventId = event.id;

    const route = selectProviderModel({ taskType: "storyboard" });
    const generateDetailedStoryboard = process.env.AI_MODE === "real" ? deepseekProvider.generateStoryboard : generateRoutedStoryboard;
    let partialShotCount = 0;
    let result = await generateDetailedStoryboard(owned.project.brief, owned.project.strategy, {
      sessionId: session.id,
      requestedShotCount: timeline.shotCount,
      targetDurationSec: timeline.targetDurationSec,
      shotDurationPlan: timeline.shotDurationPlan,
      productVisualSpec: productSpec.spec,
      onStoryboardChunk: async (shots, progress) => {
        await saveOwnedStoryboardChunk(session.id, projectId!, shots);
        partialShotCount = progress.completed;
        await updateGenerationEventProgress(
          session.id,
          projectId!,
          eventId!,
          progress.completed,
          progress.total,
          progress.splitRetry
            ? "本次生成内容较长，系统正在拆分生成，请稍候。"
            : `正在分段生成文字分镜，已保存 ${progress.completed} / ${progress.total} 镜。`
        );
      },
      ...(parsed.data.regenerateExisting ? { providerTimeoutMs: 20_000, maxProviderAttempts: 1 } : {})
    });
    if (result.data && !storyboardMatchesPlanning(owned.project, result.data)) {
      result = await generateDetailedStoryboard(owned.project.brief, owned.project.strategy, {
        sessionId: session.id,
        requestedShotCount: timeline.shotCount,
        targetDurationSec: timeline.targetDurationSec,
        shotDurationPlan: timeline.shotDurationPlan,
        productVisualSpec: productSpec.spec,
        onStoryboardChunk: async (shots, progress) => {
          await saveOwnedStoryboardChunk(session.id, projectId!, shots);
          partialShotCount = progress.completed;
          await updateGenerationEventProgress(session.id, projectId!, eventId!, progress.completed, progress.total, `正在修复分镜结构，已保存 ${progress.completed} / ${progress.total} 镜。`);
        },
        maxProviderAttempts: 1
      });
    }
    if (result.data && !storyboardMatchesPlanning(owned.project, result.data)) {
      const code = result.data.length !== constraints.shotCount ? "SHOT_COUNT_MISMATCH" : "DURATION_PLAN_MISMATCH";
      await failGenerationEvent(session.id, projectId, eventId, code === "SHOT_COUNT_MISMATCH"
        ? "生成的分镜数量与广告需求不一致，自动修复后仍未通过。"
        : "生成的分镜总时长与广告需求不一致，自动修复后仍未通过。", code);
      return apiJson({ success: false, data: null, trace: { route: "generate-storyboard", stage: "planning-check", errorCode: code }, fallbackUsed: false, error: code === "SHOT_COUNT_MISMATCH" ? "分镜数量未能匹配广告需求，请重新生成。" : "分镜总时长未能匹配广告需求，请重新生成。" }, 422);
    }
    let responseShots = result.data ?? [];
    if (result.data) {
      const invalidatedAssetIds = parsed.data.regenerateExisting
        ? collectTimelineAssetIds(owned.project)
        : [];
      await replaceOwnedProjectShots(session.id, projectId, result.data, undefined, {
        invalidateExistingAssets: parsed.data.regenerateExisting === true
      });
      await markPrivateAssetsLifecycle(session.id, projectId, invalidatedAssetIds, "orphaned");
      const current = await requireOwnedAnonymousProject(session.id, projectId);
      const updated = await updateOwnedAnonymousProject(session.id, projectId, {
        ...(productSpec.spec ? { productVisualSpec: productSpec.spec } : {}),
        workflowSteps: {
          ...(current.project.workflowSteps ?? defaultWorkflow()),
          brief: "completed", strategy: "completed", storyboard: "completed"
        }
      });
      const narration = await generateNarrationPlan(updated.project.brief, updated.project.strategy, updated.project.shots, {
        sessionId: session.id,
        maxProviderAttempts: 1
      });
      const narrationPlan = narration.success && narration.data ? narration.data : buildPartialNarrationPlan(updated.project);
      const withNarration = await updateOwnedAnonymousProject(session.id, projectId, { narrationPlan });
      responseShots = withNarration.project.shots;
      await completeGenerationEvent(session.id, projectId, eventId,
        `分镜生成完成，共 ${responseShots.length} 个镜头，总时长 ${responseShots.reduce((sum, shot) => sum + shot.durationSec, 0)} 秒。`,
        { status: "completed", latencyMs: result.latencyMs, progressCurrent: responseShots.length, progressTotal: responseShots.length }
      );
    } else {
      await failGenerationEvent(session.id, projectId, eventId, partialShotCount
        ? `分镜未全部生成，已保留前 ${partialShotCount} 镜。${storyboardPublicError(result.error)}`
        : storyboardPublicError(result.error));
    }

    const publicError = result.error ? storyboardPublicError(result.error) : null;

    return apiJson({
      success: result.success,
      data: result.data ? { shots: responseShots } : null,
      trace: {
        route: "generate-storyboard", taskType: "storyboard", provider: result.provider, model: result.model,
        latencyMs: result.latencyMs, tokenUsage: result.tokenUsage, costEstimate: result.costEstimate,
        plannedRoute: route,
        diagnostic: publicError ? { title: "DeepSeek 生成失败", detail: publicError } : null
      },
      fallbackUsed: false,
      fallbackReason: null,
      error: publicError
    });
  } catch (error) {
    const detail = sanitizeApiError(error);
    if (eventId && projectId) await failGenerationEvent(session.id, projectId, eventId, `分镜生成或保存失败：${detail}`).catch(() => undefined);
    const projectError = projectStoreErrorResponse(error);
    if (projectError) return projectError;
    return apiJson({ success: false, data: null, trace: { route: "generate-storyboard", stage: "exception" }, fallbackUsed: false, error: detail }, 500);
  }
}

function storyboardPublicError(error?: string | null) {
  if (/DEEPSEEK_OUTPUT_TRUNCATED|输出达到长度上限/i.test(error ?? "")) {
    return "本次生成内容过多，已超出单次长度限制。系统建议分段生成分镜内容。";
  }
  if (/DEEPSEEK_/i.test(error ?? "")) return "DeepSeek 暂时未能完成文字分镜，请稍后重试。";
  return error || "文字分镜生成失败，请稍后重试。";
}

function storyboardMatchesPlanning(project: GenerationProject, shots: GenerationProject["shots"]): boolean {
  try {
    assertStoryboardMatchesPlanning(project, shots);
    return true;
  } catch {
    return false;
  }
}

function collectTimelineAssetIds(project: GenerationProject): string[] {
  return Array.from(new Set([
    ...(project.keyframes ?? []).map((keyframe) => keyframe.assetId),
    project.heroVideo?.assetId,
    project.finalVideo?.assetId,
    project.narrationAssetId,
    ...(project.narrationPlan?.beats ?? []).map((beat) => beat.assetId),
    project.finalVideoAssetId
  ].filter((assetId): assetId is string => Boolean(assetId))));
}
function defaultWorkflow() {
  return {
    brief: "completed" as const, strategy: "pending" as const, storyboard: "pending" as const,
    keyframes: "pending" as const, heroShot: "pending" as const, render: "pending" as const
  };
}
