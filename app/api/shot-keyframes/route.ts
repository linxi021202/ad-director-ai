import { z } from "zod";
import { NextResponse } from "next/server";
import { getMissingKeyframeIds, getShotKeyframeViewState } from "@/lib/image/keyframeViewState";
import { projectStoreErrorResponse } from "@/lib/projects/api";
import { anonymousProjectIdSchema, requireOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent, updateGenerationEventProgress } from "@/lib/projects/generationEvents";
import { getAnonymousApiSession } from "@/lib/session/api";

const inputSchema = z.object({ projectId: anonymousProjectIdSchema, shotId: z.string().min(1).max(140), frameId: z.string().min(1).max(140).optional() }).strict();
const globalJobs = globalThis as typeof globalThis & { __adDirectorShotJobs?: Map<string, Promise<void>> };
const jobs = globalJobs.__adDirectorShotJobs ?? new Map<string, Promise<void>>();
globalJobs.__adDirectorShotJobs = jobs;
const admitting = new Set<string>();
const json = (value: { success: boolean; data?: unknown; error?: string }, status = 200) =>
  NextResponse.json({ data: null, ...value }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: "镜头生成请求无效。" }, 400);
  const { projectId, shotId, frameId } = parsed.data;
  const key = `${sessionResult.session.id}:${projectId}:${shotId}`;
  if (admitting.has(key)) return json({ success: false, error: "当前镜头任务正在创建，请稍候查看进度。" }, 409);
  admitting.add(key);
  try {
    const { project } = await requireOwnedAnonymousProject(sessionResult.session.id, projectId);
    if (project.stageStates?.storyboard.status !== "locked") return json({ success: false, error: "请先确认文字分镜。" }, 409);
    const shot = project.shots.find((item) => item.id === shotId);
    if (!shot) return json({ success: false, error: "当前镜头不存在，请刷新项目。" }, 404);
    if (frameId && !shot.frames?.some((item) => item.id === frameId && !item.isLocked))
      return json({ success: false, error: "当前帧不存在或已确认，请先取消确认。" }, 409);
    const active = project.generationEvents?.findLast((event) => event.action === "制作单镜关键帧" && event.shotId === shotId
      && ["queued", "running", "qa-review"].includes(event.status));
    if (active && jobs.has(key)) return json({ success: true, data: { status: "running", eventId: active.id, jobId: active.runId, shotId } }, 202);
    if (active) return json({ success: false, error: "当前镜头仍有任务在处理，请稍后刷新查看进度，避免重复提交。" }, 409);
    const event = await startGenerationEvent(sessionResult.session.id, projectId, {
      stage: "keyframes", provider: "system", action: "制作单镜关键帧", shotId,
      message: "正在准备当前镜头生成参数。", progressCurrent: 0, progressTotal: 2
    });
    const job = runShotJob({ sessionId: sessionResult.session.id, projectId, shotId, frameId, eventId: event.id,
      origin: new URL(request.url).origin, cookie: request.headers.get("cookie") ?? "" })
      .finally(() => { if (jobs.get(key) === job) jobs.delete(key); });
    jobs.set(key, job);
    return json({ success: true, data: { status: "running", eventId: event.id, jobId: event.runId, shotId } }, 202);
  } catch (error) {
    return projectStoreErrorResponse(error) ?? json({ success: false, error: "当前镜头任务启动失败，请稍后重试。" }, 500);
  } finally {
    admitting.delete(key);
  }
}

export async function GET(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const url = new URL(request.url);
  const projectId = anonymousProjectIdSchema.safeParse(url.searchParams.get("projectId"));
  const eventId = z.string().uuid().safeParse(url.searchParams.get("eventId"));
  if (!projectId.success || !eventId.success) return json({ success: false, error: "任务编号无效。" }, 400);
  try {
    const { project } = await requireOwnedAnonymousProject(sessionResult.session.id, projectId.data);
    const event = project.generationEvents?.find((item) => item.id === eventId.data && item.action === "制作单镜关键帧");
    if (!event) return json({ success: false, error: "未找到当前镜头任务。" }, 404);
    return json({ success: true, data: { status: event.status, eventId: event.id, jobId: event.runId, shotId: event.shotId,
      message: event.message, progressCurrent: event.progressCurrent, progressTotal: event.progressTotal } });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? json({ success: false, error: "任务状态读取失败。" }, 500);
  }
}

async function runShotJob(input: { sessionId: string; projectId: string; shotId: string; frameId?: string; eventId: string; origin: string; cookie: string }) {
  const { sessionId, projectId, shotId, eventId } = input;
  const endpoint = (path: string) => new URL(path, input.origin).toString();
  const headers = { "content-type": "application/json", cookie: input.cookie };
  try {
    let project = (await requireOwnedAnonymousProject(sessionId, projectId)).project;
    let shot = project.shots.find((item) => item.id === shotId)!;
    if (getShotKeyframeViewState(project, shotId).promptStatus !== "ready") {
      const response = await fetch(endpoint("/api/generate-assets"), { method: "POST", headers, cache: "no-store",
        body: JSON.stringify({ projectId, brief: project.brief, strategy: project.strategy, shots: [shot], batchSize: 1 }) });
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
    const response = await fetch(endpoint("/api/generate-images"), { method: "POST", headers, cache: "no-store",
      body: JSON.stringify({ projectId, shots: [shot], mode: "single-shot", aspectRatio: project.brief.aspectRatio, frameIds,
        retryResponseTimeout: Boolean(input.frameId && project.generationEvents?.some((event) => event.stage === "keyframes"
          && event.frameId === input.frameId && event.errorCode === "PROVIDER_RESPONSE_TIMEOUT")) }) });
    const submitted = await response.json().catch(() => null) as { success?: boolean; data?: { eventId?: string; status?: string }; error?: string } | null;
    if (!response.ok || !submitted?.success || !submitted.data?.eventId)
      throw new Error(publicShotError(submitted?.error));
    while (submitted.data.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const poll = await fetch(endpoint(`/api/generate-images?projectId=${encodeURIComponent(projectId)}&eventId=${submitted.data!.eventId}`),
        { headers: { cookie: input.cookie }, cache: "no-store" });
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
    const message = error instanceof Error ? error.message : "当前镜头制作失败，请查看镜头日志后重试。";
    await failGenerationEvent(sessionId, projectId, eventId, message, "MODEL_REQUEST_FAILED").catch(() => undefined);
  }
}

function publicShotError(message?: string) {
  if (!message || /[A-Z][A-Z_]{3,}|https?:\/\/|\b(?:Zod|JSON|Schema|payload)\b/.test(message))
    return "当前镜头关键帧未生成成功，请查看镜头日志后重试。";
  return message;
}
