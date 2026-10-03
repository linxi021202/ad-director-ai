import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { generateAssetsForSession } from "@/app/api/generate-assets/route";
import { generateImagesForSession, getImageBatchForSession } from "@/app/api/generate-images/route";
import { getMissingKeyframeIds, getShotKeyframeViewState } from "@/lib/image/keyframeViewState";
import { anonymousProjectIdSchema, AnonymousProjectNotFoundError, requireOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import { appendGenerationEvent, completeGenerationEvent, failGenerationEvent, heartbeatGenerationEvent, normalizeInterruptedEvents, startGenerationEvent, updateGenerationEventProgress } from "@/lib/projects/generationEvents";
import { getAnonymousApiSession } from "@/lib/session/api";

const inputSchema = z.object({ projectId: anonymousProjectIdSchema, shotId: z.string().min(1).max(140), frameId: z.string().min(1).max(140).optional() }).strict();
const globalJobs = globalThis as typeof globalThis & { __adDirectorShotJobs?: Map<string, Promise<void>> };
const jobs = globalJobs.__adDirectorShotJobs ?? new Map<string, Promise<void>>();
globalJobs.__adDirectorShotJobs = jobs;
const admitting = new Set<string>();
const json = (data: unknown, status = 200) => NextResponse.json({ ok: true, success: true, data },
  { status, headers: { "cache-control": "no-store" } });
const failure = (code: string, message: string, requestId: string, status: number) => NextResponse.json({
  ok: false, success: false, data: null, error: { code, message, requestId }
}, { status, headers: { "cache-control": "no-store" } });

async function recordPreflightFailure(sessionId: string, projectId: string, shotId: string, requestId: string, code: string, message: string) {
  await appendGenerationEvent(sessionId, projectId, { requestId, stage: "keyframes", provider: "system",
    action: "创建单镜关键帧任务", status: "failed", shotId, errorCode: code, message }).catch(() => undefined);
}

export async function POST(request: Request) {
  const requestId = z.string().uuid().safeParse(request.headers.get("x-request-id")).data ?? randomUUID();
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return failure("SESSION_INITIALIZATION_FAILED", "无法初始化临时会话，请刷新页面后重试。", requestId, 500);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failure("REQUEST_VALIDATION_FAILED", "镜头生成请求无效。", requestId, 400);
  const { projectId, shotId, frameId } = parsed.data;
  const key = `${sessionResult.session.id}:${projectId}:${shotId}`;
  if (admitting.has(key)) return failure("JOB_CREATION_PENDING", "当前镜头任务正在创建，请稍候查看进度。", requestId, 409);
  admitting.add(key);
  try {
    await normalizeInterruptedEvents(sessionResult.session.id, projectId);
    const { project } = await requireOwnedAnonymousProject(sessionResult.session.id, projectId);
    if (project.stageStates?.storyboard.status !== "locked") {
      await recordPreflightFailure(sessionResult.session.id, projectId, shotId, requestId, "STORYBOARD_NOT_LOCKED", "请先确认文字分镜。");
      return failure("STORYBOARD_NOT_LOCKED", "请先确认文字分镜。", requestId, 409);
    }
    const shot = project.shots.find((item) => item.id === shotId);
    if (!shot) {
      await recordPreflightFailure(sessionResult.session.id, projectId, shotId, requestId, "REQUEST_VALIDATION_FAILED", "当前镜头不存在，请刷新项目。");
      return failure("REQUEST_VALIDATION_FAILED", "当前镜头不存在，请刷新项目。", requestId, 404);
    }
    if (frameId && !shot.frames?.some((item) => item.id === frameId && !item.isLocked)) {
      await recordPreflightFailure(sessionResult.session.id, projectId, shotId, requestId, "REQUEST_VALIDATION_FAILED", "当前帧不存在或已确认，请先取消确认。");
      return failure("REQUEST_VALIDATION_FAILED", "当前帧不存在或已确认，请先取消确认。", requestId, 409);
    }
    const active = project.generationEvents?.findLast((event) => event.action === "制作单镜关键帧" && event.shotId === shotId
      && ["queued", "running", "qa-review"].includes(event.status));
    if (active) return json({ status: active.status, eventId: active.id, jobId: active.runId, projectId, shotId,
      requestId: active.requestId ?? requestId, createdAt: active.startedAt }, 202);
    const event = await startGenerationEvent(sessionResult.session.id, projectId, {
      requestId, stage: "keyframes", provider: "system", action: "制作单镜关键帧", shotId,
      message: "正在准备当前镜头生成参数。", progressCurrent: 0, progressTotal: 2
    });
    const job = runShotJob({ sessionId: sessionResult.session.id, projectId, shotId, frameId, eventId: event.id, requestId })
      .finally(() => { if (jobs.get(key) === job) jobs.delete(key); });
    jobs.set(key, job);
    return json({ status: "running", eventId: event.id, jobId: event.runId, projectId, shotId, requestId, createdAt: event.startedAt }, 202);
  } catch (error) {
    const notFound = error instanceof AnonymousProjectNotFoundError;
    console.error("[shot-keyframes] job creation failed", { requestId, projectId, shotId, error });
    if (!notFound) await recordPreflightFailure(sessionResult.session.id, projectId, shotId, requestId,
      "JOB_CREATION_FAILED", "关键帧任务创建失败，请重试。");
    return failure(notFound ? "PROJECT_LOAD_FAILED" : "JOB_CREATION_FAILED",
      notFound ? "项目不存在或当前会话无法访问。" : "关键帧任务创建失败，请重试。", requestId, notFound ? 404 : 500);
  } finally {
    admitting.delete(key);
  }
}

export async function GET(request: Request) {
  const requestId = z.string().uuid().safeParse(request.headers.get("x-request-id")).data ?? randomUUID();
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return failure("SESSION_INITIALIZATION_FAILED", "无法初始化临时会话，请刷新页面后重试。", requestId, 500);
  const url = new URL(request.url);
  const projectId = anonymousProjectIdSchema.safeParse(url.searchParams.get("projectId"));
  const eventId = z.string().uuid().safeParse(url.searchParams.get("eventId"));
  if (!projectId.success || !eventId.success) return failure("REQUEST_VALIDATION_FAILED", "任务编号无效。", requestId, 400);
  try {
    await normalizeInterruptedEvents(sessionResult.session.id, projectId.data);
    const { project } = await requireOwnedAnonymousProject(sessionResult.session.id, projectId.data);
    const event = project.generationEvents?.find((item) => item.id === eventId.data && item.action === "制作单镜关键帧");
    if (!event) return failure("JOB_NOT_FOUND", "未找到当前镜头任务。", requestId, 404);
    return json({ status: event.status, eventId: event.id, jobId: event.runId, shotId: event.shotId,
      requestId: event.requestId, message: event.message, progressCurrent: event.progressCurrent, progressTotal: event.progressTotal });
  } catch (error) {
    console.error("[shot-keyframes] job status failed", { requestId, projectId: projectId.data, eventId: eventId.data, error });
    return failure("JOB_STATUS_FAILED", "任务状态读取失败。", requestId, 500);
  }
}

async function runShotJob(input: { sessionId: string; projectId: string; shotId: string; frameId?: string; eventId: string; requestId: string }) {
  const { sessionId, projectId, shotId, eventId } = input;
  const headers = { "content-type": "application/json" };
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void heartbeatGenerationEvent(sessionId, projectId, eventId).catch(() => undefined)
      .finally(() => { heartbeatBusy = false; });
  }, 20_000);
  try {
    let project = (await requireOwnedAnonymousProject(sessionId, projectId)).project;
    let shot = project.shots.find((item) => item.id === shotId)!;
    if (getShotKeyframeViewState(project, shotId).promptStatus !== "ready") {
      const response = await generateAssetsForSession(sessionId, new Request("http://internal/api/generate-assets", { method: "POST", headers,
        body: JSON.stringify({ projectId, brief: project.brief, strategy: project.strategy, shots: [shot], batchSize: 1 }) }), input.requestId);
      if (!response.ok) throw new Error("当前镜头生成参数准备失败，请查看镜头日志后重试。");
      project = (await requireOwnedAnonymousProject(sessionId, projectId)).project;
      if (getShotKeyframeViewState(project, shotId).promptStatus !== "ready")
        throw new Error("当前镜头生成参数尚未完整保存，已保留成功部分，请重试当前镜头。");
    }
    await updateGenerationEventProgress(sessionId, projectId, eventId, 1, 2, "正在生成当前镜头关键帧。");
    shot = project.shots.find((item) => item.id === shotId)!;
    const view = getShotKeyframeViewState(project, shotId);
    const frameIds = input.frameId ? [input.frameId] : view.completedCount === view.totalCount
      ? (shot.frames ?? []).filter((frame) => !frame.isLocked).map((frame) => frame.id)
      : getMissingKeyframeIds(project, shotId);
    if (!frameIds.length) throw new Error("当前镜头没有可生成的关键帧，请先取消已确认图片的确认状态。");
    const response = await generateImagesForSession(sessionId, new Request("http://internal/api/generate-images", { method: "POST", headers,
      body: JSON.stringify({ projectId, shots: [shot], mode: "single-shot", aspectRatio: project.brief.aspectRatio, frameIds,
        retryResponseTimeout: Boolean(input.frameId && project.generationEvents?.some((event) => event.stage === "keyframes"
          && event.frameId === input.frameId && event.errorCode === "PROVIDER_RESPONSE_TIMEOUT")) }) }), input.requestId);
    const submitted = await response.json().catch(() => null) as { success?: boolean; data?: { eventId?: string; status?: string }; error?: string } | null;
    if (!response.ok || !submitted?.success || !submitted.data?.eventId)
      throw new Error(publicShotError(submitted?.error));
    while (submitted.data.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const poll = await getImageBatchForSession(sessionId, new Request(`http://internal/api/generate-images?projectId=${encodeURIComponent(projectId)}&eventId=${submitted.data!.eventId}`));
      const result = await poll.json().catch(() => null) as { success?: boolean; data?: { status?: string }; error?: string } | null;
      if (!poll.ok || !result?.success) throw new Error(publicShotError(result?.error));
      if (result.data?.status === "completed") break;
    }
    project = (await requireOwnedAnonymousProject(sessionId, projectId)).project;
    const final = getShotKeyframeViewState(project, shotId);
    if (frameIds.some((id) => !final.frameViews.some((item) => item.frame?.id === id && item.imageUrl && item.metadata?.status === "ready")))
      throw new Error("当前镜头部分关键帧未生成成功，已完成的图片已保留；请重试缺失帧。");
    await completeGenerationEvent(sessionId, projectId, eventId, "当前镜头关键帧已保存。", { progressCurrent: 2, progressTotal: 2 });
  } catch (error) {
    console.error("[shot-keyframes] job execution failed", { requestId: input.requestId, projectId, shotId, eventId, error });
    const message = publicShotError(error instanceof Error ? error.message : undefined);
    await failGenerationEvent(sessionId, projectId, eventId, message, "MODEL_REQUEST_FAILED").catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
  }
}

function publicShotError(message?: string) {
  if (!message || /fetch failed|failed to fetch|ECONNRESET|AbortError|[A-Z][A-Z_]{3,}|https?:\/\/|\b(?:Zod|JSON|Schema|payload)\b/i.test(message))
    return "当前镜头关键帧未生成成功，请查看镜头日志后重试。";
  return message;
}
