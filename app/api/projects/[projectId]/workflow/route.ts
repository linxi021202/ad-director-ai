import { NextResponse } from "next/server";
import { z } from "zod";

import {
  calculateOwnedProjectDependencyImpact,
  createOwnedProjectResourceVersion,
  lockOwnedProjectStage,
  requireOwnedAnonymousProject,
  setOwnedProjectStageStatus
} from "@/lib/projects/anonymousProjectStore";
import { parseOwnedProjectId, projectNotFoundResponse, projectStoreErrorResponse, publicAnonymousProject } from "@/lib/projects/api";
import { stageIdSchema, versionedResourceTypeSchema } from "@/lib/schemas/project";
import { getAnonymousApiSession } from "@/lib/session/api";
import { STAGE_RESOURCE } from "@/lib/workflow/stageGates";

const workflowActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("lock-stage"),
    expectedVersion: z.number().int().positive(),
    stageId: stageIdSchema
  }).strict(),
  z.object({
    action: z.literal("set-stage-status"),
    expectedVersion: z.number().int().positive(),
    stageId: stageIdSchema,
    status: z.enum(["draft", "running", "ready", "failed"]),
    errorCode: z.string().trim().min(1).max(80).optional()
  }).strict(),
  z.object({
    action: z.literal("create-version"),
    expectedVersion: z.number().int().positive(),
    stageId: stageIdSchema,
    resourceId: z.string().trim().min(1).max(140),
    resourceType: versionedResourceTypeSchema,
    label: z.string().trim().min(1).max(160).optional()
  }).strict()
]);

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = parseOwnedProjectId((await context.params).projectId);
  if (!projectId) return projectNotFoundResponse();

  try {
    await requireOwnedAnonymousProject(sessionResult.session.id, projectId);
    const resourceId = new URL(request.url).searchParams.get("resourceId")?.trim();
    if (!resourceId || resourceId.length > 140) {
      return NextResponse.json({ error: { code: "INVALID_PROJECT_REQUEST", message: "缺少有效的资源 ID。" } }, { status: 400 });
    }
    const impact = await calculateOwnedProjectDependencyImpact(sessionResult.session.id, projectId, resourceId);
    return NextResponse.json({ success: true, data: { impact } });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? NextResponse.json({
      error: { code: "WORKFLOW_READ_FAILED", message: "阶段依赖读取失败。" }
    }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = parseOwnedProjectId((await context.params).projectId);
  if (!projectId) return projectNotFoundResponse();

  try {
    await requireOwnedAnonymousProject(sessionResult.session.id, projectId);
    const body = workflowActionSchema.parse(await request.json());
    const record = body.action === "lock-stage"
      ? await lockOwnedProjectStage(sessionResult.session.id, projectId, body.stageId, body.expectedVersion)
      : body.action === "set-stage-status"
        ? await setOwnedProjectStageStatus(
            sessionResult.session.id,
            projectId,
            body.stageId,
            body.status,
            body.expectedVersion,
            body.errorCode
          )
        : await createVersion(sessionResult.session.id, projectId, body);
    return NextResponse.json({ success: true, data: publicAnonymousProject(record) });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? NextResponse.json({
      error: { code: "WORKFLOW_UPDATE_FAILED", message: "阶段状态更新失败。" }
    }, { status: 500 });
  }
}

async function createVersion(
  sessionId: string,
  projectId: string,
  body: Extract<z.infer<typeof workflowActionSchema>, { action: "create-version" }>
) {
  const stageResource = STAGE_RESOURCE[body.stageId];
  if (body.resourceId !== stageResource.resourceId || body.resourceType !== stageResource.resourceType) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["resourceId"],
      message: "资源与阶段不匹配。"
    }]);
  }
  return createOwnedProjectResourceVersion(sessionId, projectId, body, body.expectedVersion);
}
