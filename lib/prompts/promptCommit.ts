import "server-only";

import { ZodError } from "zod";
import { sanitizeApiError } from "../api/response";
import { upsertModelCallLog, type ModelCallLog } from "../logs/modelCallStore";
import { AnonymousProjectVersionConflictError, requireOwnedAnonymousProject, saveOwnedShotPromptPackage } from "../projects/anonymousProjectStore";
import { completeGenerationEvent } from "../projects/generationEvents";
import { detailedShotPromptPackageSchema, type DetailedShotPromptPackage, type ProductVisualSpec } from "../schemas/project";
import { reviewDetailedPromptPackage } from "../director/promptQualityReview";
import { ensureShotArchitecture } from "../storyboard/shotArchitecture";
import { validateDetailedKeyframePlan } from "../storyboard/keyframePlan";
import { matchesShotPromptInputFingerprint } from "./shotPromptFingerprint";
import { isShotPromptReady } from "./shotPromptReadiness";

export type PromptFailurePhase = "MODEL_REQUEST_FAILED" | "SCHEMA_VALIDATION_FAILED" | "PROMPT_QA_FAILED"
  | "PROMPT_BUNDLE_BUILD_FAILED" | "PROMPT_BUNDLE_VALIDATION_FAILED" | "PROJECT_PERSIST_FAILED"
  | "VERSION_CONFLICT" | "TASK_STATE_TRANSITION_FAILED" | "UNKNOWN_INTERNAL_ERROR";
type CommitContext = { sessionId: string; projectId: string; shotId: string; taskId: string; jobId?: string };
type Versions = { projectVersionBefore?: number; projectVersionExpected?: number; projectVersionActual?: number };

export class PromptCommitError extends Error {
  constructor(public readonly failurePhase: PromptFailurePhase, public readonly originalError: unknown, public readonly versions: Versions) {
    super(promptCommitPublicMessage(failurePhase));
    this.name = "PromptCommitError";
  }
}

export function promptCommitPublicMessage(phase: PromptFailurePhase) {
  if (phase === "PROJECT_PERSIST_FAILED") return "镜头详细提示词保存失败，已生成内容保留，可直接重试保存。";
  if (phase === "VERSION_CONFLICT") return "镜头上游内容已更新，请刷新后重试；已保存的提示词不会重复生成。";
  if (phase === "TASK_STATE_TRANSITION_FAILED") return "镜头提示词已保存，任务状态提交异常，请重试当前步骤。";
  return "镜头提示词处理异常，已保存内容保留，请重试当前步骤。";
}

export async function bestEffortPromptLog(sessionId: string, input: Parameters<typeof upsertModelCallLog>[1]) {
  try { await upsertModelCallLog(sessionId, input); return true; }
  catch (error) {
    console.warn("PROMPT_TELEMETRY_WARNING", input.mode, sanitizeApiError(error));
    return false;
  }
}

export function promptErrorDetails(error: unknown, phase: PromptFailurePhase): Partial<ModelCallLog> {
  const original = error instanceof PromptCommitError ? error.originalError : error;
  const failurePhase = original instanceof AnonymousProjectVersionConflictError ? "VERSION_CONFLICT"
    : error instanceof PromptCommitError ? error.failurePhase : phase;
  const object = original && typeof original === "object" ? original as { name?: string; message?: string; stack?: string; cause?: { code?: string }; code?: string } : undefined;
  return { failurePhase, errorCode: failurePhase, errorName: object?.name ?? typeof original,
    errorSummary: object?.message ?? String(original), errorStack: object?.stack,
    causeCode: object?.cause?.code ?? object?.code,
    ...(original instanceof ZodError ? { validationIssues: original.issues.slice(0, 20).map((issue) => ({
      path: issue.path.join("."), code: issue.code, message: issue.message
    })) } : {}),
    ...(error instanceof PromptCommitError ? error.versions : {}) };
}

export async function recordPromptCommitStep(context: CommitContext, mode: string, metadata: Partial<ModelCallLog> = {}) {
  return bestEffortPromptLog(context.sessionId, { kind: "call", projectId: context.projectId, taskId: context.taskId,
    jobId: context.jobId, shotId: context.shotId, stage: "prompts", provider: "system", mode,
    status: "completed", startedAt: Date.now(), completedAt: Date.now(), durationMs: 0,
    resultVersion: "final", ...metadata });
}

export async function commitFinalPromptBundle(context: CommitContext, raw: DetailedShotPromptPackage,
  inputFingerprint: string, productVisualSpec?: ProductVisualSpec, latencyMs = 0) {
  let phase: PromptFailurePhase = "PROMPT_BUNDLE_BUILD_FAILED";
  const versions: Versions = {};
  const warnings: string[] = [];
  const step = async (mode: string, metadata: Partial<ModelCallLog> = {}) => {
    if (!await recordPromptCommitStep(context, mode, { ...versions, ...metadata })) warnings.push(mode);
  };
  try {
    await step("prompt-bundle-building");
    const before = await requireOwnedAnonymousProject(context.sessionId, context.projectId);
    versions.projectVersionBefore = before.version;
    const shot = before.project.shots.find((item) => item.id === context.shotId);
    if (!shot || raw?.shotId !== shot.id) throw new Error("PROMPT_BUNDLE_SHOT_NOT_FOUND");
    phase = "PROMPT_BUNDLE_VALIDATION_FAILED";
    const bundle = detailedShotPromptPackageSchema.parse({ ...raw, schemaVersion: 2, inputFingerprint });
    if (!reviewDetailedPromptPackage(bundle).passed || !validateDetailedKeyframePlan(ensureShotArchitecture(shot), bundle.framePrompts).passed) {
      throw new Error("FINAL_CANONICAL_RESULT_NOT_READY");
    }
    await step("prompt-bundle-validated", { canonicalValid: true });
    phase = "VERSION_CONFLICT";
    const fingerprintMatches = matchesShotPromptInputFingerprint(inputFingerprint, { brief: before.project.brief, strategy: before.project.strategy,
      shot, previousShot: before.project.shots.find((item) => item.index === shot.index - 1),
      productVisualSpec: before.project.productVisualSpec ?? productVisualSpec,
      visualContinuityBible: before.project.visualContinuityBible, referencePack: before.project.referencePack });
    if (!fingerprintMatches) throw new AnonymousProjectVersionConflictError();
    phase = "PROJECT_PERSIST_FAILED";
    const projectPatchStartedAt = Date.now();
    await step("prompt-bundle-persisting", { projectPatchStartedAt, projectVersionBefore: before.version });
    const saved = await saveOwnedShotPromptPackage(context.sessionId, context.projectId, bundle, productVisualSpec);
    versions.projectVersionActual = saved.version;
    const verified = await requireOwnedAnonymousProject(context.sessionId, context.projectId);
    const projectPatchCompletedAt = Date.now();
    const persistedShot = verified.project.shots.find((item) => item.id === context.shotId);
    const promptBundlePersisted = verified.project.shotPromptPackages?.some((item) => item.shotId === context.shotId
      && item.inputFingerprint === inputFingerprint) ?? false;
    const shotStatusPersisted = Boolean(persistedShot && isShotPromptReady(verified.project, persistedShot));
    const persistDiagnostics = { projectPatchStartedAt, projectPatchCompletedAt, projectVersionBefore: before.version,
      projectVersionAfter: verified.version, shotStatusPersisted, promptBundlePersisted };
    if (!promptBundlePersisted || !shotStatusPersisted) throw new Error("PERSISTED_PROMPT_BUNDLE_NOT_READY");
    await step("prompt-bundle-persisted", { ...persistDiagnostics, canonicalValid: true, finalUsed: true });
    await step("shot-status-updating");
    await step("shot-status-ready", { ...persistDiagnostics, canonicalValid: true, finalUsed: true });
    phase = "TASK_STATE_TRANSITION_FAILED";
    await step("task-completing");
    await completeGenerationEvent(context.sessionId, context.projectId, context.taskId, `镜头 ${shot.index} 的图片与视频提示词已保存。`, { latencyMs });
    await step("task-completed", { ...persistDiagnostics, canonicalValid: true, finalUsed: true });
    return { bundle, record: verified, warnings };
  } catch (error) {
    if (error instanceof AnonymousProjectVersionConflictError) phase = "VERSION_CONFLICT";
    const actual = await requireOwnedAnonymousProject(context.sessionId, context.projectId).catch(() => undefined);
    versions.projectVersionActual = actual?.version ?? versions.projectVersionActual;
    const failure = new PromptCommitError(phase, error, versions);
    await recordPromptCommitStep(context, "prompt-commit-failed", { status: "failed", ...promptErrorDetails(failure, phase) });
    throw failure;
  }
}
