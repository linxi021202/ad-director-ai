import { z } from "zod";

import { diagnoseProviderFallback } from "../../../lib/api/provider-diagnostics";
import { buildCreativeBible } from "../../../lib/continuity/projectContinuity";
import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { projectNotFoundResponse, projectStoreErrorResponse } from "../../../lib/projects/api";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent } from "../../../lib/projects/generationEvents";
import {
  anonymousProjectIdSchema,
  requireOwnedAnonymousProject,
  updateOwnedAnonymousProject
} from "../../../lib/projects/anonymousProjectStore";
import { generateStrategy, selectProviderModel } from "../../../lib/providers/providerRouter";
import { productBriefSchema } from "../../../lib/schemas/project";
import { getAnonymousApiSession } from "../../../lib/session/api";
import { MAX_SHOT_COUNT, MAX_SHOT_DURATION_SEC, MIN_SHOT_COUNT, MIN_SHOT_DURATION_SEC, resolveShotPlan } from "../../../lib/video/shotConfig";

const requestSchema = z.object({
  projectId: anonymousProjectIdSchema,
  brief: productBriefSchema,
  requestedShotCount: z.number().int().min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT).optional(),
  targetDurationSec: z.number().int().min(12).max(60).optional(),
  shotDurationPlan: z.array(z.number().int().min(MIN_SHOT_DURATION_SEC).max(MAX_SHOT_DURATION_SEC)).min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT).optional()
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
      return apiJson({ success: false, data: null, trace: { route: "generate-strategy", stage: "validation" }, fallbackUsed: false, error: "项目 ID 或商品简报无效。" }, 400);
    }

    projectId = parsed.data.projectId;
    const owned = await requireOwnedAnonymousProject(session.id, projectId);
    const timeline = resolveShotPlan(
      parsed.data.requestedShotCount ?? owned.project.shotCount,
      parsed.data.shotDurationPlan ?? owned.project.shots.map((shot) => shot.durationSec),
      parsed.data.targetDurationSec ?? owned.project.targetDurationSec ?? parsed.data.brief.durationSec
    );
    const event = await startGenerationEvent(session.id, projectId, {
      stage: "strategy", provider: "deepseek", action: "生成广告策略", message: "DeepSeek 正在生成广告策略。"
    });
    eventId = event.id;

    const route = selectProviderModel({ taskType: "strategy" });
    const result = await generateStrategy(parsed.data.brief, {
      sessionId: session.id,
      requestedShotCount: timeline.shotCount,
      targetDurationSec: timeline.targetDurationSec,
      shotDurationPlan: timeline.shotDurationPlan
    });
    if (result.data) {
      const creativeBible = buildCreativeBible(parsed.data.brief, result.data);
      const current = await requireOwnedAnonymousProject(session.id, projectId);
      await updateOwnedAnonymousProject(session.id, projectId, {
        brief: parsed.data.brief,
        strategy: result.data,
        creativeBible,
        aspectRatio: parsed.data.brief.aspectRatio,
        shotCount: timeline.shotCount,
        targetDurationSec: timeline.targetDurationSec,
        durationSec: timeline.totalDurationSec,
        platform: parsed.data.brief.platform,
        status: "generating",
        workflowSteps: {
          ...(current.project.workflowSteps ?? defaultWorkflow()),
          brief: "completed",
          strategy: result.fallbackUsed ? "fallback" : "completed"
        }
      });
      await completeGenerationEvent(session.id, projectId, eventId,
        result.fallbackUsed ? "策略生成失败，已使用本地模板继续。" : "广告策略生成完成。",
        { status: result.fallbackUsed ? "fallback" : "completed", latencyMs: result.latencyMs }
      );
    } else {
      await failGenerationEvent(session.id, projectId, eventId, "广告策略生成失败，请检查模型配置后重试。");
    }

    return apiJson({
      success: result.success,
      data: result.data ? { strategy: result.data, creativeBible: buildCreativeBible(parsed.data.brief, result.data) } : null,
      trace: {
        route: "generate-strategy", taskType: "strategy", provider: result.provider, model: result.model,
        latencyMs: result.latencyMs, tokenUsage: result.tokenUsage, costEstimate: result.costEstimate,
        plannedRoute: route,
        diagnostic: result.fallbackUsed || result.error ? diagnoseProviderFallback(result.fallbackReason ?? result.error) : null
      },
      fallbackUsed: result.fallbackUsed,
      fallbackReason: result.fallbackReason,
      error: result.error
    });
  } catch (error) {
    if (eventId && projectId) await failGenerationEvent(session.id, projectId, eventId, "广告策略生成失败，请稍后重试。").catch(() => undefined);
    const projectError = projectStoreErrorResponse(error);
    if (projectError) return projectError;
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") return projectNotFoundResponse();
    return apiJson({ success: false, data: null, trace: { route: "generate-strategy", stage: "exception" }, fallbackUsed: false, error: sanitizeApiError(error) }, 500);
  }
}

function defaultWorkflow() {
  return {
    brief: "completed" as const, strategy: "pending" as const, storyboard: "pending" as const,
    keyframes: "pending" as const, heroShot: "pending" as const, render: "pending" as const
  };
}
