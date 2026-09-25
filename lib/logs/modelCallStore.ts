import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { requireOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import { generationEventSchema } from "@/lib/schemas/project";

const modelCallLogSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["task", "call"]),
  taskId: z.string().uuid(),
  jobId: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  stage: z.string().min(1).max(40),
  provider: z.string().min(1).max(40),
  model: z.string().max(100).optional(),
  mode: z.string().max(80).optional(),
  pass: z.enum(["A", "B", "C", "D"]).optional(),
  shotId: z.string().max(140).optional(),
  frameId: z.string().max(140).optional(),
  chunkIndex: z.number().int().nonnegative().optional(),
  attempt: z.number().int().positive().optional(),
  status: z.enum(["queued", "running", "qa-review", "completed", "needs-review", "failed", "fallback", "cancelled", "blocked", "interrupted"]),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  jobElapsedMs: z.number().int().nonnegative().optional(),
  lastHeartbeatAt: z.number().int().nonnegative().optional(),
  interruptedAt: z.number().int().nonnegative().optional(),
  progressCurrent: z.number().int().nonnegative().optional(),
  progressTotal: z.number().int().positive().optional(),
  errorCode: z.string().max(80).optional(),
  errorSummary: z.string().max(500).optional(),
  providerErrorCode: z.string().max(100).optional(),
  validationPath: z.string().max(200).optional(),
  validationIssues: z.array(z.object({ path: z.string().max(200), code: z.string().max(80), message: z.string().max(300) }).strict()).max(20).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  providerRequestId: z.string().max(200).optional(),
  providerTaskId: z.string().max(200).optional(),
  submissionStatus: z.string().max(40).optional(),
  providerTaskStatus: z.string().max(40).optional(),
  pollCount: z.number().int().nonnegative().optional(),
  submittedAt: z.number().int().nonnegative().optional(),
  lastPolledAt: z.number().int().nonnegative().optional(),
  nextPollAt: z.number().int().nonnegative().optional(),
  submissionElapsedMs: z.number().int().nonnegative().optional(),
  generationElapsedMs: z.number().int().nonnegative().optional(),
  downloadElapsedMs: z.number().int().nonnegative().optional(),
  imageUrl: z.string().regex(/^(https?:\/\/|\/api\/projects\/)/).max(2048).optional(),
  finalAssetId: z.string().uuid().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  outputLength: z.number().int().nonnegative().optional(),
  finishReason: z.string().max(80).optional(),
  requestOptions: z.object({ temperature: z.number().optional(), maxTokens: z.number().int().positive().optional(), responseFormat: z.enum(["json", "text"]).optional(), thinking: z.string().max(30).optional(), size: z.string().max(30).optional(), referenceCount: z.number().int().min(0).max(3).optional(), endpointMode: z.string().max(60).optional(), promptExtend: z.boolean().optional(), watermark: z.boolean().optional() }).strict().optional(),
  jsonParsed: z.boolean().optional(),
  schemaValid: z.boolean().optional(),
  normalized: z.boolean().optional(),
  repaired: z.boolean().optional(),
  chunkSaved: z.boolean().optional(),
  referenceAssetIds: z.array(z.string().uuid()).max(12).optional(),
  outputAssetIds: z.array(z.string().uuid()).max(12).optional(),
  referenceImageCount: z.number().int().min(0).max(3).optional(),
  referenceImagesIncluded: z.boolean().optional(),
  plannedMode: z.string().max(80).optional(),
  actualMode: z.string().max(80).optional(),
  downgradeAuthorized: z.boolean().optional(),
  message: z.string().max(500).optional()
}).strict();

export type ModelCallLog = z.infer<typeof modelCallLogSchema>;
type ModelCallLogInput = Omit<ModelCallLog, "id"> & { id?: string };
const logFileSchema = z.object({ version: z.literal(1), entries: z.array(modelCallLogSchema).max(500) }).strict();
const queues = new Map<string, Promise<void>>();
const RETENTION_MS = 30 * 24 * 60 * 60_000;
export const MODEL_CALL_LOG_LIMIT = 500;

export async function upsertModelCallLog(sessionId: string, input: ModelCallLogInput): Promise<ModelCallLog> {
  await requireOwnedAnonymousProject(sessionId, input.projectId);
  const entry = sanitizeLog({ ...input, id: input.id ?? randomUUID() } as ModelCallLog);
  const file = logPath(sessionId);
  await serialize(file, async () => {
    const existing = await readLogFile(file);
    const entries = existing.entries.filter((item) => item.id !== entry.id && item.startedAt > Date.now() - RETENTION_MS);
    entries.push(entry);
    entries.sort((left, right) => left.startedAt - right.startedAt);
    await writeLogFile(file, { version: 1, entries: entries.slice(-500) });
  });
  return entry;
}

export async function listModelCallLogs(sessionId: string, options: { projectId?: string; shotId?: string; frameId?: string; stage?: string; before?: number; limit?: number } = {}): Promise<ModelCallLog[]> {
  if (options.projectId) await requireOwnedAnonymousProject(sessionId, options.projectId);
  const file = logPath(sessionId);
  let result: ModelCallLog[] = [];
  await serialize(file, async () => {
    const stored = await readLogFile(file);
    result = stored.entries
      .filter((entry) => (!options.projectId || entry.projectId === options.projectId) && (!options.shotId || entry.shotId === options.shotId) && (!options.frameId || entry.frameId === options.frameId) && (!options.stage || entry.stage === options.stage) && (!options.before || entry.startedAt < options.before))
      .sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id))
      .slice(0, Math.min(100, Math.max(1, options.limit ?? 50)));
  });
  return result;
}

export async function readModelCallLogArchive(sessionId: string, projectId: string, taskId?: string) {
  await requireOwnedAnonymousProject(sessionId, projectId);
  const file = logPath(sessionId);
  let archive: Awaited<ReturnType<typeof readLogFile>> = { version: 1, entries: [] };
  await serialize(file, async () => { archive = await readLogFile(file); });
  const entries = archive.entries.filter((entry) => entry.projectId === projectId && (!taskId || entry.taskId === taskId))
    .map(sanitizeLog)
    .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id));
  return { entries, retentionLimitReached: archive.entries.length >= MODEL_CALL_LOG_LIMIT, retentionDays: 30, firstAvailableAt: archive.entries[0]?.startedAt ?? null };
}

export async function clearModelCallLogs(sessionId: string, projectId: string): Promise<number> {
  await requireOwnedAnonymousProject(sessionId, projectId);
  const file = logPath(sessionId);
  let removed = 0;
  await serialize(file, async () => {
    const stored = await readLogFile(file);
    removed = stored.entries.filter((entry) => entry.projectId === projectId).length;
    if (removed) await writeLogFile(file, { version: 1, entries: stored.entries.filter((entry) => entry.projectId !== projectId) });
  });
  return removed;
}

export async function mirrorGenerationEvent(sessionId: string, raw: z.infer<typeof generationEventSchema>): Promise<void> {
  const event = generationEventSchema.parse(raw);
  await upsertModelCallLog(sessionId, {
    id: event.id, kind: "task", taskId: event.id, jobId: event.runId, projectId: event.projectId,
    stage: event.stage, provider: event.provider, shotId: event.shotId, frameId: event.frameId,
    status: event.status, startedAt: event.startedAt, completedAt: event.completedAt,
    durationMs: event.latencyMs,
    jobElapsedMs: (event.completedAt ?? Date.now()) - event.startedAt,
    lastHeartbeatAt: event.lastHeartbeatAt ?? event.startedAt,
    interruptedAt: event.interruptedAt,
    progressCurrent: event.progressCurrent, progressTotal: event.progressTotal,
    errorCode: event.errorCode, errorSummary: event.status === "failed" ? event.message : undefined,
    providerRequestId: event.providerRequestId, providerTaskId: event.providerTaskId,
    message: event.message
  });
}

function sanitizeLog(entry: ModelCallLog): ModelCallLog {
  const clean = (value: string | undefined, max: number) => value?.replace(/Authorization\s*[:=]\s*[^\s,;]+/gi, "Authorization=[已隐藏]")
    .replace(/Cookie\s*[:=]\s*[^\r\n]+/gi, "Cookie=[已隐藏]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [已隐藏]")
    .replace(/(?:sk|dashscope)[-_][A-Za-z0-9_-]{8,}/gi, "[密钥已隐藏]")
    .replace(/(?:session[-_ ]?token|access[-_ ]?token|token|api[_-]?key|secret)\s*[:=]\s*[^\s,;&]+/gi, "[凭据已隐藏]")
    .replace(/https?:\/\/[^\s]+/gi, "[链接已隐藏]")
    .replace(/[A-Za-z]:\\[^\r\n]+/g, "[本地路径已隐藏]")
    .slice(0, max);
  return modelCallLogSchema.parse({
    ...entry,
    ...(entry.errorSummary ? { errorSummary: clean(entry.errorSummary, 500) } : {}),
    ...(entry.message ? { message: clean(entry.message, 500) } : {}),
    ...(entry.validationPath ? { validationPath: clean(entry.validationPath, 200) } : {}),
    ...(entry.providerErrorCode ? { providerErrorCode: clean(entry.providerErrorCode, 100) } : {}),
    ...(entry.validationIssues ? { validationIssues: entry.validationIssues.slice(0, 20).map((issue) => ({ path: clean(issue.path, 200) ?? "", code: clean(issue.code, 80) ?? "", message: clean(issue.message, 300) ?? "" })) } : {}),
    ...(entry.providerRequestId ? { providerRequestId: clean(entry.providerRequestId, 200) } : {}),
    ...(entry.providerTaskId ? { providerTaskId: clean(entry.providerTaskId, 200) } : {})
  });
}

async function readLogFile(file: string): Promise<z.infer<typeof logFileSchema>> {
  try {
    const parsed = logFileSchema.parse(JSON.parse(await readFile(file, "utf8")));
    return { ...parsed, entries: parsed.entries.map((entry) => entry.kind === "task" && entry.errorCode === "TASK_INTERRUPTED" && entry.durationMs !== undefined && entry.jobElapsedMs === undefined
      ? { ...entry, durationMs: undefined, jobElapsedMs: entry.durationMs }
      : entry) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { version: 1, entries: [] };
    throw error;
  }
}

async function writeLogFile(file: string, data: z.infer<typeof logFileSchema>) {
  const temporary = `${file}.tmp-${randomUUID()}`;
  await mkdir(path.dirname(file), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(logFileSchema.parse(data))}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function logPath(sessionId: string) {
  const root = path.resolve(process.env.STORAGE_ROOT?.trim() || path.join(process.cwd(), "storage"));
  const namespace = createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  const candidate = path.resolve(root, "sessions", namespace, "model-calls.json");
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("UNSAFE_CALL_LOG_PATH");
  return candidate;
}

async function serialize(file: string, work: () => Promise<void>) {
  const previous = queues.get(file) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(work);
  queues.set(file, pending);
  try { await pending; } finally { if (queues.get(file) === pending) queues.delete(file); }
}
