import "server-only";

import { randomUUID } from "node:crypto";

import { mirrorGenerationEvent } from "@/lib/logs/modelCallStore";
import { mutateOwnedAnonymousProject, requireOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import { setLastActiveProjectId } from "@/lib/projects/anonymousWorkspace";
import {
  generationEventSchema,
  type GenerationEvent,
  type GenerationEventStatus,
  type GenerationProvider,
  type GenerationStage
} from "@/lib/schemas/project";

const MAX_EVENTS = 200;
const MAX_MESSAGE_LENGTH = 500;
const ALLOWED_ERROR_CODES = new Set([
  "PROVIDER_REQUEST_FAILED",
  "PROVIDER_SUBMIT_TIMEOUT",
  "PROVIDER_STATUS_TIMEOUT",
  "PROVIDER_TIMEOUT",
  "PROVIDER_INVALID_RESPONSE",
  "SCHEMA_VALIDATION_FAILED",
  "FALLBACK_USED",
  "ASSET_VALIDATION_FAILED",
  "ASSET_UPLOAD_FAILED",
  "VIDEO_DURATION_OUT_OF_TOLERANCE",
  "RENDER_FAILED",
  "RENDER_CANCELLED",
  "TASK_INTERRUPTED",
  "BRIEF_NOT_LOCKED",
  "CREATIVE_NOT_LOCKED",
  "VISUAL_ANCHOR_NOT_LOCKED",
  "VISUAL_ANCHORS_INCOMPLETE",
  "STORYBOARD_NOT_LOCKED",
  "PRODUCT_REFERENCE_REQUIRED",
  "PRODUCT_VISUAL_SPEC_REQUIRED",
  "PRODUCT_MASTER_NOT_LOCKED",
  "CHARACTER_MASTER_REQUIRED",
  "SCENE_MASTER_REQUIRED",
  "DEPENDENCY_OUTDATED",
  "PROJECT_VERSION_CONFLICT",
  "MODEL_SCHEMA_DRIFT",
  "MODEL_STATE_CONTINUITY",
  "PROMPT_EXPANSION_PARTIAL_FAILURE",
  "NOT_CONFIGURED",
  "RATE_LIMITED",
  "QUOTA_EXHAUSTED"
]);

const STAGE_TIMEOUT_MS: Record<GenerationStage, number> = {
  brief: 5 * 60_000,
  creative: 10 * 60_000,
  anchors: 20 * 60_000,
  strategy: 10 * 60_000,
  storyboard: 15 * 60_000,
  prompts: 15 * 60_000,
  keyframes: 30 * 60_000,
  video: 45 * 60_000,
  "hero-shot": 45 * 60_000,
  narration: 20 * 60_000,
  final: 60 * 60_000,
  composition: 60 * 60_000
};

type NewEventInput = {
  stage: GenerationStage;
  provider: GenerationProvider;
  action: string;
  status?: GenerationEventStatus;
  message: string;
  shotId?: string;
  frameId?: string;
  progressCurrent?: number;
  progressTotal?: number;
  errorCode?: string;
  runId?: string;
  schemaVersion?: number;
};

export function sanitizeGenerationEvent(event: GenerationEvent): GenerationEvent {
  return generationEventSchema.parse({
    ...event,
    action: sanitizeText(event.action, 120),
    message: sanitizeText(event.message, MAX_MESSAGE_LENGTH),
    ...(event.errorCode ? { errorCode: sanitizeErrorCode(event.errorCode) } : {})
  });
}

export async function appendGenerationEvent(
  sessionId: string,
  projectId: string,
  input: NewEventInput
): Promise<GenerationEvent> {
  const now = Date.now();
  const event = sanitizeGenerationEvent({
    id: randomUUID(),
    runId: input.runId ?? randomUUID(),
    projectId,
    stage: input.stage,
    provider: input.provider,
    action: input.action,
    status: input.status ?? "queued",
    message: input.message,
    ...(input.shotId ? { shotId: input.shotId } : {}),
    ...(input.frameId ? { frameId: input.frameId } : {}),
    ...(input.progressCurrent !== undefined ? { progressCurrent: input.progressCurrent } : {}),
    ...(input.progressTotal !== undefined ? { progressTotal: input.progressTotal } : {}),
    startedAt: now,
    lastHeartbeatAt: now,
    ...(isTerminal(input.status) ? { completedAt: now } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.schemaVersion ? { schemaVersion: input.schemaVersion } : {})
  });

  await mutateOwnedAnonymousProject(sessionId, projectId, (project) => ({
    ...project,
    generationEvents: pruneEvents([...(project.generationEvents ?? []), event])
  }));
  await mirrorGenerationEvent(sessionId, event).catch(() => undefined);
  await setLastActiveProjectId(sessionId, projectId);
  return event;
}

export function startGenerationEvent(
  sessionId: string,
  projectId: string,
  input: Omit<NewEventInput, "status">
) {
  return appendGenerationEvent(sessionId, projectId, { ...input, status: "running" });
}

export function completeGenerationEvent(
  sessionId: string,
  projectId: string,
  eventId: string,
  message: string,
  details: { status?: "completed" | "fallback" | "cancelled" | "needs-review"; latencyMs?: number; progressCurrent?: number; progressTotal?: number } = {}
) {
  return updateEvent(sessionId, projectId, eventId, {
    status: details.status ?? "completed",
    message,
    completedAt: Date.now(),
    ...(details.latencyMs !== undefined ? { latencyMs: Math.max(0, Math.round(details.latencyMs)) } : {}),
    ...(details.progressCurrent !== undefined ? { progressCurrent: details.progressCurrent } : {}),
    ...(details.progressTotal !== undefined ? { progressTotal: details.progressTotal } : {})
  });
}

export function markGenerationEventQAReview(
  sessionId: string,
  projectId: string,
  eventId: string,
  message: string
) {
  return updateEvent(sessionId, projectId, eventId, { status: "qa-review", message });
}

export function failGenerationEvent(
  sessionId: string,
  projectId: string,
  eventId: string,
  message: string,
  errorCode = "PROVIDER_REQUEST_FAILED"
) {
  return updateEvent(sessionId, projectId, eventId, {
    status: "failed",
    message,
    errorCode: sanitizeErrorCode(errorCode),
    completedAt: Date.now()
  });
}

export function updateGenerationEventProgress(
  sessionId: string,
  projectId: string,
  eventId: string,
  progressCurrent: number,
  progressTotal: number,
  message?: string
) {
  return updateEvent(sessionId, projectId, eventId, {
    progressCurrent: Math.max(0, Math.round(progressCurrent)),
    progressTotal: Math.max(1, Math.round(progressTotal)),
    ...(message ? { message } : {})
  });
}

export function attachGenerationEventProviderTask(
  sessionId: string,
  projectId: string,
  eventId: string,
  details: { taskId: string; requestId?: string; message?: string; status?: "running" }
) {
  return updateEvent(sessionId, projectId, eventId, {
    ...(details.status ? { status: details.status, completedAt: undefined } : {}),
    providerTaskId: sanitizeText(details.taskId, 200),
    ...(details.requestId ? { providerRequestId: sanitizeText(details.requestId, 200) } : {}),
    ...(details.message ? { message: details.message } : {})
  });
}

export async function listGenerationEvents(
  sessionId: string,
  projectId: string,
  options: { after?: number; limit?: number } = {}
): Promise<GenerationEvent[]> {
  await normalizeInterruptedEvents(sessionId, projectId);
  const record = await requireOwnedAnonymousProject(sessionId, projectId);
  const after = Math.max(0, options.after ?? 0);
  const limit = Math.min(200, Math.max(1, options.limit ?? 200));
  return (record.project.generationEvents ?? [])
    .filter((event) => event.startedAt > after)
    .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
    .slice(-limit);
}

export async function clearGenerationEvents(
  sessionId: string,
  projectId: string
): Promise<{ clearedCount: number; version: number }> {
  let clearedCount = 0;
  const record = await mutateOwnedAnonymousProject(sessionId, projectId, (project) => {
    clearedCount = project.generationEvents?.length ?? 0;
    return { ...project, generationEvents: [] };
  });
  return { clearedCount, version: record.version };
}

export async function normalizeInterruptedEvents(sessionId: string, projectId: string): Promise<void> {
  const record = await requireOwnedAnonymousProject(sessionId, projectId);
  const now = Date.now();
  const hasStale = (record.project.generationEvents ?? []).some(
    (event) => event.status === "running" && now - (event.lastHeartbeatAt ?? event.startedAt) > STAGE_TIMEOUT_MS[event.stage]
  );
  if (!hasStale) return;

  const updated = await mutateOwnedAnonymousProject(sessionId, projectId, (project) => ({
    ...project,
    generationEvents: (project.generationEvents ?? []).map((event) => {
      if (event.status !== "running" || now - (event.lastHeartbeatAt ?? event.startedAt) <= STAGE_TIMEOUT_MS[event.stage]) return event;
      return sanitizeGenerationEvent({
        ...event,
        status: "interrupted",
        message: "任务超过阶段静默期限；可能因服务重启、请求中断或进程失联，无法仅凭此记录判断模型是否失败。已保存的内容仍可继续使用。",
        completedAt: now,
        interruptedAt: now,
        errorCode: "TASK_INTERRUPTED"
      });
    })
  }));
  await Promise.all((updated.project.generationEvents ?? [])
    .filter((event) => event.status === "interrupted" && event.completedAt === now)
    .map((event) => mirrorGenerationEvent(sessionId, event).catch(() => undefined)));
}

async function updateEvent(
  sessionId: string,
  projectId: string,
  eventId: string,
  patch: Partial<Pick<GenerationEvent, "status" | "message" | "completedAt" | "latencyMs" | "errorCode" | "progressCurrent" | "progressTotal" | "providerTaskId" | "providerRequestId">>
): Promise<GenerationEvent> {
  let updated: GenerationEvent | undefined;
  await mutateOwnedAnonymousProject(sessionId, projectId, (project) => ({
    ...project,
    generationEvents: (project.generationEvents ?? []).map((event) => {
      if (event.id !== eventId) return event;
      updated = sanitizeGenerationEvent({ ...event, ...patch, lastHeartbeatAt: Date.now() });
      return updated;
    })
  }));
  if (!updated) throw new Error("GENERATION_EVENT_NOT_FOUND");
  await mirrorGenerationEvent(sessionId, updated).catch(() => undefined);
  return updated;
}

function pruneEvents(events: GenerationEvent[]): GenerationEvent[] {
  if (events.length <= MAX_EVENTS) return events;
  const critical = events.filter((event) => event.status === "failed" || (event.stage === "composition" && event.status === "completed"));
  const recent = events.slice(-(MAX_EVENTS - Math.min(20, critical.length)));
  const merged = new Map<string, GenerationEvent>();
  for (const event of [...critical.slice(-20), ...recent]) merged.set(event.id, event);
  return [...merged.values()].sort((left, right) => left.startedAt - right.startedAt).slice(-MAX_EVENTS);
}

function sanitizeText(value: string, maxLength: number): string {
  const cleaned = value
    .replace(/Authorization\s*:\s*[^\r\n]*/gi, "Authorization: [已隐藏]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [已隐藏]")
    .replace(/(?:sk|dashscope)[-_][A-Za-z0-9_-]{8,}/gi, "[密钥已隐藏]")
    .replace(/(?:DEEPSEEK_API_KEY|DASHSCOPE_API_KEY|HAPPYHORSE_API_KEY|DATABASE_URL)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .replace(/[A-Za-z]:\\[^\r\n]+/g, "[本地路径已隐藏]")
    .replace(/\/(?:Users|home|var|tmp)\/[^\r\n]+/g, "[本地路径已隐藏]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .trim();
  return (cleaned || "任务状态已更新。").slice(0, maxLength);
}

function sanitizeErrorCode(value: string): string {
  return ALLOWED_ERROR_CODES.has(value) ? value : "PROVIDER_REQUEST_FAILED";
}

function isTerminal(status: GenerationEventStatus | undefined): boolean {
  return Boolean(status && ["completed", "needs-review", "failed", "fallback", "cancelled", "blocked", "interrupted"].includes(status));
}
