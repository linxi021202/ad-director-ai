import "server-only";

import { NextResponse } from "next/server";
import type { ZodError } from "zod";

import { authorizeOwnedProject } from "@/lib/projects/api";
import { updateOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import {
  cancelProjectRender,
  getProjectRenderState,
  startProjectRender
} from "@/lib/render/renderManager";
import { renderRequestSchema } from "@/lib/render/renderProject";
import { isActiveRenderStatus } from "@/lib/render/renderStateStore";
import { getAnonymousApiSession } from "@/lib/session/api";
import { getProjectDurationSec } from "@/lib/video/durationConfig";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const authorization = await authorizeOwnedProject(
    sessionResult.session.id,
    (await context.params).projectId
  );
  if (!authorization.authorized) return authorization.response;
  return response(true, await getProjectRenderState(authorization.projectId), null, 200);
}

export async function POST(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  const authorization = await authorizeOwnedProject(
    session.id,
    (await context.params).projectId
  );
  if (!authorization.authorized) return authorization.response;

  try {
    const current = await getProjectRenderState(authorization.projectId);
    if (isActiveRenderStatus(current.status)) {
      return response(false, current, "当前项目正在渲染，请等待完成或先取消。", 409);
    }

    const body = await readRequestBody(request);
    if (body === null) {
      return response(false, null, "渲染请求缺少项目与关键帧数据，请刷新页面后重试。", 400);
    }
    const parsed = renderRequestSchema.safeParse(body);
    if (!parsed.success) {
      return response(false, null, renderValidationMessage(parsed.error), 400);
    }

    const state = await startProjectRender(
      authorization.projectId,
      {
        ...parsed.data,
        project: authorization.record.project
      },
      session.id,
      new URL(request.url).origin
    );
    await updateOwnedAnonymousProject(session.id, authorization.projectId, {
      status: "generating",
      finalVideo: {
        status: state.status,
        progress: state.progress,
        durationSec: getProjectDurationSec(authorization.record.project),
        storageTransition: "PRIVATE_ASSET_V1"
      },
      workflowSteps: {
        ...(authorization.record.project.workflowSteps ?? defaultWorkflow()),
        render: "running"
      }
    });
    return response(true, state, null, 202);
  } catch (error) {
    return response(false, null, renderStartupMessage(error), renderStartupStatus(error));
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;
  const authorization = await authorizeOwnedProject(
    session.id,
    (await context.params).projectId
  );
  if (!authorization.authorized) return authorization.response;

  const state = await cancelProjectRender(authorization.projectId);
  await updateOwnedAnonymousProject(session.id, authorization.projectId, {
    finalVideo: {
      status: "cancelled",
      progress: state.progress,
      storageTransition: "PRIVATE_ASSET_V1"
    },
    workflowSteps: {
      ...(authorization.record.project.workflowSteps ?? defaultWorkflow()),
      render: "pending"
    }
  });
  return response(true, state, null, 200);
}

async function readRequestBody(request: Request) {
  try {
    return await request.json() as unknown;
  } catch {
    return null;
  }
}

function renderValidationMessage(error: ZodError) {
  const firstPath = error.issues[0]?.path.map(String).join(".") ?? "";
  if (!firstPath || firstPath === "project") {
    return "渲染请求缺少完整项目数据，请刷新页面后重试。";
  }
  if (firstPath.startsWith("project.")) {
    return "项目数据不完整：" + firstPath.replace(/^project./, "") + "。";
  }
  if (firstPath.startsWith("keyframes")) {
    return "关键帧清单格式无效，请重新生成关键帧后重试。";
  }
  return "渲染参数无效，请刷新项目后重试。";
}

function renderStartupMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/EACCES|EPERM/i.test(message)) {
    return "渲染任务无法写入私有存储目录，请检查项目目录权限。";
  }
  if (/ENOSPC/i.test(message)) {
    return "磁盘空间不足，无法启动渲染任务。";
  }
  if (/ASSET_NOT_FOUND|ASSET_FILE_UNREADABLE/i.test(message)) {
    return "渲染素材不存在或无法读取，请重新生成相关素材。";
  }
  if (/RENDER_QUEUE_FULL|渲染队列已满/i.test(message)) {
    return "当前渲染队列已满，请稍后再试。";
  }
  return "渲染任务创建失败，请检查本地渲染环境后重试。";
}

function renderStartupStatus(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /RENDER_QUEUE_FULL|渲染队列已满/i.test(message) ? 503 : 500;
}

function defaultWorkflow() {
  return {
    brief: "completed" as const,
    strategy: "completed" as const,
    storyboard: "completed" as const,
    keyframes: "completed" as const,
    heroShot: "completed" as const,
    render: "pending" as const
  };
}

function response(success: boolean, data: unknown, error: string | null, status: number) {
  return NextResponse.json({
    success,
    data,
    trace: { route: "project-render" },
    fallbackUsed: false,
    fallbackReason: null,
    error
  }, { status });
}
