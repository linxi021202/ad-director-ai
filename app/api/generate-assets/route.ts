import { z } from "zod";

import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { projectStoreErrorResponse } from "../../../lib/projects/api";
import {
  anonymousProjectIdSchema,
  requireOwnedAnonymousProject,
  saveOwnedShotPromptDraft,
  saveOwnedShotPromptPackage,
  updateOwnedAnonymousProject
} from "../../../lib/projects/anonymousProjectStore";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent, updateGenerationEventProgress } from "../../../lib/projects/generationEvents";
import { selectProviderModel } from "../../../lib/providers/providerRouter";
import { expandShotPrompts } from "../../../lib/providers/deepseekProvider";
import { buildShotPromptInputFingerprint, SHOT_PROMPT_PACKAGE_SCHEMA_VERSION } from "../../../lib/prompts/shotPromptFingerprint";
import type { ShotPromptExpansionInput } from "../../../lib/prompts/detailedDirectorPrompts";
import { reviewDetailedPromptPackage } from "../../../lib/director/promptQualityReview";
import { adStrategySchema, productBriefSchema, storyboardShotSchema, type DetailedShotPromptDraft, type DetailedShotPromptPackage, type StoryboardShot } from "../../../lib/schemas/project";
import { getAnonymousApiSession } from "../../../lib/session/api";
import { resolveProjectProductVisualSpec } from "../../../lib/visual/productVisualSpec";

const requestSchema = z.object({
  projectId: anonymousProjectIdSchema,
  brief: productBriefSchema,
  strategy: adStrategySchema,
  shots: z.array(storyboardShotSchema).min(1).max(12),
  batchSize: z.number().int().min(1).max(2).default(1)
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
    const requestedShotIds = new Set(parsed.data.shots.map((shot) => shot.id));
    const promptInputs = buildPromptInputs(owned.project, productSpec.spec, requestedShotIds);
    if (!promptInputs.length || promptInputs.length !== requestedShotIds.size) {
      return apiJson({ success: false, data: null, trace: { route: "generate-assets", stage: "validation" }, fallbackUsed: false, error: "请求中的镜头与当前项目不一致，请刷新页面后重试。" }, 409);
    }
    const completedAtStart = validPromptPackageIds(owned.project.shotPromptPackages ?? [], promptInputs);
    const pendingInputs = promptInputs.filter((input) => !completedAtStart.has(input.shot.id));
    const sourceInputs = pendingInputs.slice(0, parsed.data.batchSize);
    const event = await startGenerationEvent(session.id, projectId, {
      stage: "prompts",
      provider: "deepseek",
      action: "生成镜头提示词",
      message: pendingInputs.length
        ? `DeepSeek 正在继续完善镜头提示词，已完成 ${completedAtStart.size} / ${promptInputs.length} 个镜头。`
        : "所有镜头提示词均为最新版本，无需重复生成。",
      progressCurrent: completedAtStart.size,
      progressTotal: promptInputs.length
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
        data: {
          shots,
          plannedAssets,
          promptPackages: owned.project.shotPromptPackages ?? [],
          processedShotIds: [],
          remainingShotIds: [],
          completedCount: shots.length,
          totalCount: shots.length,
          continuationRequired: false,
          failures: []
        },
        trace: { route: "generate-assets", taskType: "prompt", provider: promptRoute.provider, model: promptRoute.model, latencyMs: 0, imageProvider: imageRoute.model, videoProvider: videoRoute.model, realImageCalled: false, realVideoCalled: false },
        fallbackUsed: false,
        fallbackReason: null,
        error: null
      });
    }
    const packages: DetailedShotPromptPackage[] = [];
    const failures: string[] = [];
    let totalLatencyMs = 0;
    for (const [shotOffset, input] of sourceInputs.entries()) {
      const shot = input.shot;
      const inputFingerprint = buildShotPromptInputFingerprint(input);
      let checkpoint: DetailedShotPromptDraft = owned.project.shotPromptDrafts?.find((item) =>
        item.shotId === shot.id
        && item.schemaVersion === SHOT_PROMPT_PACKAGE_SCHEMA_VERSION
        && item.inputFingerprint === inputFingerprint
      ) ?? {
        shotId: shot.id,
        schemaVersion: SHOT_PROMPT_PACKAGE_SCHEMA_VERSION,
        inputFingerprint,
        framePrompts: []
      };
      const result = await expandShotPrompts(input, {
        sessionId: session.id,
        resumeShotPromptDraft: checkpoint,
        onShotPromptFoundation: async (foundation) => {
          checkpoint = { ...checkpoint, foundation };
          await saveOwnedShotPromptDraft(session.id, projectId!, checkpoint);
        },
        onShotPromptFrame: async (frame) => {
          const framesById = new Map([...checkpoint.framePrompts, frame].map((item) => [item.frameId, item]));
          checkpoint = { ...checkpoint, framePrompts: [...framesById.values()] };
          await saveOwnedShotPromptDraft(session.id, projectId!, checkpoint);
        }
      });
      totalLatencyMs += result.latencyMs;
      if (result.success && result.data) {
        const promptPackage: DetailedShotPromptPackage = {
          ...result.data,
          schemaVersion: SHOT_PROMPT_PACKAGE_SCHEMA_VERSION,
          inputFingerprint
        };
        const review = reviewDetailedPromptPackage(promptPackage);
        if (review.passed) {
          packages.push(promptPackage);
          await saveOwnedShotPromptPackage(session.id, projectId, promptPackage, productSpec.spec);
        } else failures.push(`镜头 ${shot.index}：详细提示词未通过完整性检查，请单独重试。`);
      } else failures.push(`镜头 ${shot.index}：${promptExpansionPublicError(result.error)}`);
      await updateGenerationEventProgress(
        session.id,
        projectId,
        event.id,
        completedAtStart.size + shotOffset + 1,
        promptInputs.length,
        failures.length
          ? `本次有 ${failures.length} 个镜头等待重试，之前成功内容已经保留。`
          : `已完成 ${completedAtStart.size + packages.length} / ${promptInputs.length} 个镜头的详细提示词。`
      );
    }
    const current = await requireOwnedAnonymousProject(session.id, projectId);
    const refreshedInputs = buildPromptInputs(current.project, productSpec.spec, requestedShotIds);
    const completedIds = validPromptPackageIds(current.project.shotPromptPackages ?? [], refreshedInputs);
    const remainingShotIds = refreshedInputs.filter((input) => !completedIds.has(input.shot.id)).map((input) => input.shot.id);
    const updated = await updateOwnedAnonymousProject(session.id, projectId, {
      ...(productSpec.spec ? { productVisualSpec: productSpec.spec } : {}),
      workflowSteps: {
        ...(current.project.workflowSteps ?? defaultWorkflow()),
        storyboard: failures.length ? "needs-review" : remainingShotIds.length ? "running" : "completed"
      }
    });
    const shots = updated.project.shots;
    const completedCount = refreshedInputs.length - remainingShotIds.length;

    if (failures.length) {
      await failGenerationEvent(session.id, projectId, event.id, `已完成 ${completedCount} / ${refreshedInputs.length} 个镜头，失败镜头可直接续跑。`, "PROMPT_EXPANSION_PARTIAL_FAILURE");
    } else {
      await completeGenerationEvent(
        session.id,
        projectId,
        event.id,
        remainingShotIds.length
          ? `本批已完成，系统将继续生成剩余 ${remainingShotIds.length} 个镜头。`
          : `已完成全部 ${completedCount} 个镜头的详细图片与视频提示词。`,
        { status: "completed", latencyMs: totalLatencyMs, progressCurrent: completedCount, progressTotal: refreshedInputs.length }
      );
    }

    const plannedAssets = buildPlannedAssets(shots, imageRoute.model, videoRoute.model);

    return apiJson({
      success: failures.length === 0,
      data: {
        shots,
        plannedAssets,
        promptPackages: updated.project.shotPromptPackages ?? [],
        processedShotIds: packages.map((item) => item.shotId),
        remainingShotIds,
        completedCount,
        totalCount: refreshedInputs.length,
        continuationRequired: remainingShotIds.length > 0,
        failures
      },
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

function buildPromptInputs(
  project: Awaited<ReturnType<typeof requireOwnedAnonymousProject>>["project"],
  productVisualSpec: Awaited<ReturnType<typeof resolveProjectProductVisualSpec>>["spec"],
  requestedShotIds: Set<string>
): ShotPromptExpansionInput[] {
  return project.shots.filter((shot) => requestedShotIds.has(shot.id)).map((shot) => ({
    brief: project.brief,
    strategy: project.strategy,
    shot,
    previousShot: project.shots.find((candidate) => candidate.index === shot.index - 1),
    productVisualSpec,
    visualContinuityBible: project.visualContinuityBible,
    referencePack: project.referencePack
  }));
}

function validPromptPackageIds(packages: DetailedShotPromptPackage[], inputs: ShotPromptExpansionInput[]) {
  const expectedByShot = new Map(inputs.map((input) => [input.shot.id, buildShotPromptInputFingerprint(input)]));
  return new Set(packages.filter((item) =>
    item.schemaVersion === SHOT_PROMPT_PACKAGE_SCHEMA_VERSION
    && item.inputFingerprint === expectedByShot.get(item.shotId)
  ).map((item) => item.shotId));
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
