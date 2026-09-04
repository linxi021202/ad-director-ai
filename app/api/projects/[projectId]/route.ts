import { NextResponse } from "next/server";
import { z } from "zod";

import { getAnonymousApiSession } from "@/lib/session/api";
import { productBriefSchema } from "@/lib/schemas/project";
import { selectLastActiveProjectAfterDelete, setLastActiveProjectId } from "@/lib/projects/anonymousWorkspace";
import {
  anonymousProjectPatchSchema,
  deleteOwnedAnonymousProject,
  requireOwnedAnonymousProject,
  saveOwnedProjectBrief,
  updateOwnedAnonymousProject,
  updateOwnedShotDurations
} from "@/lib/projects/anonymousProjectStore";
import {
  parseOwnedProjectId,
  projectNotFoundResponse,
  projectStoreErrorResponse,
  publicAnonymousProject
} from "@/lib/projects/api";

const projectPatchRequestSchema = z.union([
  z.object({
    expectedVersion: z.number().int().positive(),
    saveBrief: z.object({
      brief: productBriefSchema,
      shotCount: z.number().int(),
      targetDurationSec: z.number().int()
    }).strict()
  }).strict(),
  z.object({
    expectedVersion: z.number().int().positive().optional(),
    patch: anonymousProjectPatchSchema
  }).strict(),
  z.object({
    expectedVersion: z.number().int().positive(),
    shotDurations: z.array(z.object({
      shotId: z.string().min(1),
      durationSec: z.number().int()
    }).strict()).min(1).max(12)
  }).strict()
]);

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = parseOwnedProjectId((await context.params).projectId);
  if (!projectId) return projectNotFoundResponse();

  try {
    const record = await requireOwnedAnonymousProject(sessionResult.session.id, projectId);
    return NextResponse.json({ success: true, data: publicAnonymousProject(record) });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? projectNotFoundResponse();
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = parseOwnedProjectId((await context.params).projectId);
  if (!projectId) return projectNotFoundResponse();

  try {
    await requireOwnedAnonymousProject(sessionResult.session.id, projectId);
    const body = projectPatchRequestSchema.parse(await request.json());
    const record = "saveBrief" in body
      ? await saveOwnedProjectBrief(
          sessionResult.session.id,
          projectId,
          body.saveBrief,
          body.expectedVersion
        )
      : "shotDurations" in body
      ? await updateOwnedShotDurations(
          sessionResult.session.id,
          projectId,
          body.shotDurations,
          body.expectedVersion
        )
      : await updateOwnedAnonymousProject(
          sessionResult.session.id,
          projectId,
          body.patch,
          body.expectedVersion
        );
    return NextResponse.json({ success: true, data: publicAnonymousProject(record) });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? NextResponse.json({
      error: { code: "PROJECT_UPDATE_FAILED", message: "项目更新失败，请稍后重试。" }
    }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = parseOwnedProjectId((await context.params).projectId);
  if (!projectId) return projectNotFoundResponse();

  try {
    await requireOwnedAnonymousProject(sessionResult.session.id, projectId);
    await deleteOwnedAnonymousProject(sessionResult.session.id, projectId);
    return NextResponse.json({ success: true, data: { projectId } });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? projectNotFoundResponse();
  }
}
