import { z } from "zod";

import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { projectStoreErrorResponse } from "../../../lib/projects/api";
import {
  anonymousProjectIdSchema,
  requireOwnedAnonymousProject,
  saveOwnedShotPromptDraft
} from "../../../lib/projects/anonymousProjectStore";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent, updateGenerationEventProgress } from "../../../lib/projects/generationEvents";
import { selectProviderModel } from "../../../lib/providers/providerRouter";
import { expandShotPrompts } from "../../../lib/providers/deepseekProvider";
import { buildShotPromptInputFingerprint, matchesShotPromptInputFingerprint, SHOT_PROMPT_PACKAGE_SCHEMA_VERSION } from "../../../lib/prompts/shotPromptFingerprint";
import type { ShotPromptExpansionInput } from "../../../lib/prompts/detailedDirectorPrompts";
import { reviewDetailedPromptPackage } from "../../../lib/director/promptQualityReview";
import { ensureShotArchitecture } from "../../../lib/storyboard/shotArchitecture";
import { validateDetailedKeyframePlan } from "../../../lib/storyboard/keyframePlan";
import { adStrategySchema, productBriefSchema, storyboardShotSchema, type DetailedShotPromptDraft, type DetailedShotPromptPackage, type StoryboardShot } from "../../../lib/schemas/project";
import { getAnonymousApiSession } from "../../../lib/session/api";
import { resolveProjectProductVisualSpec } from "../../../lib/visual/productVisualSpec";
import { bestEffortPromptLog, commitFinalPromptBundle, PromptCommitError, promptErrorDetails, promptCommitPublicMessage, type PromptFailurePhase } from "../../../lib/prompts/promptCommit";

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
  let activeShotEventId: string | undefined;
  let projectId: string | undefined;
  let activeShotId: string | undefined;
  let failurePhase: PromptFailurePhase = "UNKNOWN_INTERNAL_ERROR";
  const completedEvents = new Set<string>();
  const warnings: string[] = [];

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
      shotId: sourceInputs.length === 1 ? sourceInputs[0]?.shot.id : undefined,
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
    let quotaExhausted = false;
    let totalLatencyMs = 0;
    for (const input of sourceInputs) {
      const shot = input.shot;
      const shotEvent = sourceInputs.length === 1 ? event : await startGenerationEvent(session.id, projectId, {
        stage: "prompts", provider: "deepseek", action: "生成单镜详细提示词", shotId: shot.id,
        runId: event.runId, message: `正在生成镜头 ${shot.index} 的详细提示词。`
      });
      activeShotEventId = shotEvent.id;
      activeShotId = shot.id;
      failurePhase = "MODEL_REQUEST_FAILED";
      const inputFingerprint = buildShotPromptInputFingerprint(input);
      let checkpoint: DetailedShotPromptDraft = owned.project.shotPromptDrafts?.find((item) =>
        item.shotId === shot.id
        && item.schemaVersion === SHOT_PROMPT_PACKAGE_SCHEMA_VERSION
        && matchesShotPromptInputFingerprint(item.inputFingerprint, input)
      ) ?? {
        shotId: shot.id,
        schemaVersion: SHOT_PROMPT_PACKAGE_SCHEMA_VERSION,
        inputFingerprint,
        framePrompts: []
      };
      const result = await expandShotPrompts(input, {
        sessionId: session.id,
        resumeShotPromptDraft: checkpoint,
        onModelCall: async (details) => {
          const endedAt = Date.now();
          await bestEffortPromptLog(session.id, {
            kind: "call", taskId: shotEvent.id, jobId: event.runId, projectId: projectId!, stage: "prompts", provider: details.promptStage === "qa" || details.mode?.endsWith("canonical-selected") ? "system" : "deepseek",
            model: details.model, pass: details.pass, shotId: details.shotId, frameId: details.frameId,
            mode: details.mode, attempt: details.attempt,
            status: details.schemaValid === false && details.jsonParsed ? "completed" : details.success ? "completed" : "failed",
            startedAt: Math.max(0, endedAt - details.latencyMs), completedAt: endedAt,
            durationMs: details.latencyMs, errorCode: details.errorCode ?? details.error?.match(/(?:DEEPSEEK|MODEL|PROMPT|FRAME|SHOT)_[A-Z_]+/)?.[0],
            errorSummary: details.error, validationPath: details.validationPath,
            providerErrorCode: details.providerErrorCode, validationIssues: details.validationIssues,
            requestOptions: details.requestOptions,
            httpStatus: details.httpStatus, providerRequestId: details.providerRequestId,
            inputTokens: details.inputTokens, outputTokens: details.outputTokens,
            outputLength: details.outputLength, finishReason: details.finishReason,
            jsonParsed: details.jsonParsed, schemaValid: details.schemaValid,
            normalized: details.normalized, repaired: details.repaired,
            promptStage: details.promptStage, resultVersion: details.resultVersion,
            qualityIssues: details.qualityIssues, canonicalValid: details.canonicalValid, finalUsed: details.finalUsed
          });
          if (details.schemaValid === false && details.jsonParsed) {
            await bestEffortPromptLog(session.id, { kind: "call", taskId: shotEvent.id, jobId: event.runId,
              projectId: projectId!, stage: "prompts", provider: "system", shotId: details.shotId, frameId: details.frameId,
              mode: "prompt-stage-validation", attempt: details.attempt, status: "failed", startedAt: endedAt,
              completedAt: endedAt, durationMs: 0, failurePhase: "SCHEMA_VALIDATION_FAILED", errorCode: "SCHEMA_VALIDATION_FAILED",
              errorSummary: details.error, validationIssues: details.validationIssues, validationPath: details.validationPath,
              jsonParsed: true, schemaValid: false, canonicalValid: false, finalUsed: false });
          }
        },
        onShotPromptFoundation: async (foundation) => {
          checkpoint = { ...checkpoint, foundation };
          try { await saveOwnedShotPromptDraft(session.id, projectId!, checkpoint); }
          catch (error) { throw new PromptCommitError("PROJECT_PERSIST_FAILED", error, {}); }
        },
        onShotPromptFrame: async (frame) => {
          const framesById = new Map([...checkpoint.framePrompts, frame].map((item) => [item.frameId, item]));
          checkpoint = { ...checkpoint, framePrompts: [...framesById.values()] };
          try { await saveOwnedShotPromptDraft(session.id, projectId!, checkpoint); }
          catch (error) { throw new PromptCommitError("PROJECT_PERSIST_FAILED", error, {}); }
        },
        onShotPromptPlanReset: async () => {
          checkpoint = { ...checkpoint, framePrompts: [] };
          try { await saveOwnedShotPromptDraft(session.id, projectId!, checkpoint); }
          catch (error) { throw new PromptCommitError("PROJECT_PERSIST_FAILED", error, {}); }
        }
      });
      failurePhase = "PROMPT_BUNDLE_BUILD_FAILED";
      if (!result) throw new Error("FINAL_PROMPT_RESULT_MISSING");
      totalLatencyMs += result.latencyMs;
      let shotFailure: string | undefined;
      let shotErrorCode: string | undefined;
      if (result.success && result.data) {
        const promptPackage: DetailedShotPromptPackage = {
          ...result.data,
          schemaVersion: SHOT_PROMPT_PACKAGE_SCHEMA_VERSION,
          inputFingerprint
        };
        const review = reviewDetailedPromptPackage(promptPackage);
        if (review.passed) {
          const committed = await commitFinalPromptBundle({ sessionId: session.id, projectId, shotId: shot.id,
            taskId: shotEvent.id, jobId: event.runId }, promptPackage, inputFingerprint, productSpec.spec, result.latencyMs);
          packages.push(committed.bundle);
          warnings.push(...committed.warnings);
          completedEvents.add(shotEvent.id);
        } else {
          shotFailure = "详细提示词未通过完整性检查，请单独重试。";
          shotErrorCode = "PROMPT_QUALITY_REVIEW_FAILED";
          await bestEffortPromptLog(session.id, { kind: "call", taskId: shotEvent.id, jobId: event.runId, projectId,
            stage: "prompts", provider: "system", mode: "quality-review", shotId: shot.id, status: "failed",
            startedAt: Date.now(), errorCode: shotErrorCode, errorSummary: review.issues.join("；").slice(0, 500),
            promptStage: "qa", resultVersion: "final", canonicalValid: true, finalUsed: false, qualityIssues: review.qualityIssues });
        }
      } else {
        shotFailure = promptExpansionPublicError(result.error);
        shotErrorCode = promptFailureCode(result.error);
        quotaExhausted = shotErrorCode === "DEEPSEEK_QUOTA_EXHAUSTED";
        await bestEffortPromptLog(session.id, { kind: "call", taskId: shotEvent.id, jobId: event.runId, projectId,
          stage: "prompts", provider: "system", mode: "prompt-stage-validation", shotId: shot.id,
          status: quotaExhausted ? "blocked" : "failed", startedAt: Date.now(),
          blockedBy: quotaExhausted ? shotErrorCode : undefined,
          errorCode: quotaExhausted ? undefined : shotErrorCode,
          errorSummary: quotaExhausted ? "上游 DeepSeek 额度不足，未执行最终校验。" : result.error ?? "详细提示词在最终组装时未通过检查。",
          promptStage: "qa", resultVersion: "final", finalUsed: false, qualityIssues: result.qualityIssues });
      }
      if (shotFailure) {
        failures.push(`镜头 ${shot.index}：${shotFailure}`);
        await failGenerationEvent(session.id, projectId, shotEvent.id, `镜头 ${shot.index} 详细提示词失败：${shotFailure}`, shotErrorCode);
      }
      activeShotEventId = undefined;
      failurePhase = "TASK_STATE_TRANSITION_FAILED";
      await updateGenerationEventProgress(
        session.id,
        projectId,
        event.id,
        completedAtStart.size + packages.length,
        promptInputs.length,
        failures.length
          ? `本次有 ${failures.length} 个镜头等待重试，之前成功内容已经保留。`
          : `已完成 ${completedAtStart.size + packages.length} / ${promptInputs.length} 个镜头的详细提示词。`
      ).catch((error) => { warnings.push("task-progress-update"); console.warn("PROMPT_PROGRESS_WARNING", sanitizeApiError(error)); });
      if (quotaExhausted) break;
    }
    const current = await requireOwnedAnonymousProject(session.id, projectId);
    const refreshedInputs = buildPromptInputs(current.project, productSpec.spec, requestedShotIds);
    const completedIds = validPromptPackageIds(current.project.shotPromptPackages ?? [], refreshedInputs);
    const remainingShotIds = refreshedInputs.filter((input) => !completedIds.has(input.shot.id)).map((input) => input.shot.id);
    const updated = current;
    const shots = updated.project.shots;
    const completedCount = refreshedInputs.length - remainingShotIds.length;

    if (sourceInputs.length !== 1) {
      if (failures.length) await failGenerationEvent(session.id, projectId, event.id,
        `已完成 ${completedCount} / ${refreshedInputs.length} 个镜头，失败镜头可直接续跑。`, "PROMPT_EXPANSION_PARTIAL_FAILURE");
      else await completeGenerationEvent(session.id, projectId, event.id,
        remainingShotIds.length ? `本批已完成，系统将继续生成剩余 ${remainingShotIds.length} 个镜头。`
          : `已完成全部 ${completedCount} 个镜头的详细图片与视频提示词。`,
        { status: "completed", latencyMs: totalLatencyMs, progressCurrent: completedCount, progressTotal: refreshedInputs.length });
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
        realVideoCalled: false,
        warnings
      },
      fallbackUsed: false,
      fallbackReason: null,
      error: quotaExhausted ? "DeepSeek 额度不足。已生成内容已保留，请补充额度或更换可用密钥后重试。"
        : failures.length ? `${failures.length} 个镜头的详细提示词尚未完成，已保留成功结果。请重试当前步骤。` : null
    }, failures.length ? 207 : 200);
  } catch (error) {
    const diagnostic = promptErrorDetails(error, failurePhase);
    const code = diagnostic.failurePhase as PromptFailurePhase;
    if (eventId && projectId) await bestEffortPromptLog(session.id, { kind: "call", taskId: activeShotEventId ?? eventId,
      jobId: eventId, projectId, shotId: activeShotId, stage: "prompts", provider: "system", mode: "prompt-pipeline-exception",
      status: "failed", startedAt: Date.now(), ...diagnostic });
    if (activeShotEventId && projectId && !completedEvents.has(activeShotEventId)) {
      await failGenerationEvent(session.id, projectId, activeShotEventId, promptCommitPublicMessage(code), code).catch(() => undefined);
    }
    if (eventId && projectId) {
      if (eventId !== activeShotEventId && !completedEvents.has(eventId)) await failGenerationEvent(session.id, projectId, eventId, promptCommitPublicMessage(code), code).catch(() => undefined);
    }
    const projectError = error instanceof PromptCommitError ? null : projectStoreErrorResponse(error);
    if (projectError) return projectError;
    return apiJson({ success: false, data: null, trace: { route: "generate-assets", stage: "exception", failurePhase: code }, fallbackUsed: false,
      error: promptCommitPublicMessage(code) }, code === "VERSION_CONFLICT" ? 409 : 500);
  }
}

function promptFailureCode(error?: string | null) {
  return error?.match(/(?:DEEPSEEK_[A-Z_]+|MODEL_SCHEMA_DRIFT|JSON_PARSE_FAILED|SCHEMA_VALIDATION_FAILED|KEYFRAME_PLAN_DUPLICATED|KEYFRAME_TRANSITION_IMPLAUSIBLE|VAGUE_PROMPT)/)?.[0] ?? "MODEL_REQUEST_FAILED";
}

function promptExpansionPublicError(error?: string | null) {
  if (/DEEPSEEK_QUOTA_EXHAUSTED/i.test(error ?? "")) {
    return "DeepSeek 额度不足，已生成内容已保留；请补充额度或更换可用密钥后重试。";
  }
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
  const expectedByShot = new Map(inputs.map((input) => [input.shot.id, input]));
  return new Set(packages.filter((item) =>
    item.schemaVersion === SHOT_PROMPT_PACKAGE_SCHEMA_VERSION
    && expectedByShot.has(item.shotId)
    && matchesShotPromptInputFingerprint(item.inputFingerprint, expectedByShot.get(item.shotId)!)
    && reviewDetailedPromptPackage(item).passed
    && validateDetailedKeyframePlan(ensureShotArchitecture(inputs.find((input) => input.shot.id === item.shotId)!.shot), item.framePrompts).passed
  ).map((item) => item.shotId));
}
