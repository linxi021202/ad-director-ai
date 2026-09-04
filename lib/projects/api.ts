import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getEffectiveShotCount, getProjectDurationSec } from "@/lib/video/shotConfig";

import {
  AnonymousProjectLimitError,
  AnonymousProjectNotFoundError,
  AnonymousProjectVersionConflictError,
  ShotConfigurationError,
  anonymousProjectIdSchema,
  requireOwnedAnonymousProject,
  type AnonymousProjectRecord
} from "./anonymousProjectStore";

export const PROJECT_NOT_FOUND_BODY = {
  error: { code: "PROJECT_NOT_FOUND", message: "项目不存在或已失效。" }
} as const;

export function publicAnonymousProject(record: AnonymousProjectRecord) {
  return {
    projectId: record.id,
    project: record.project,
    shotCount: getEffectiveShotCount(record.project),
    totalDurationSec: getProjectDurationSec(record.project),
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt
  };
}

export function parseOwnedProjectId(raw: string): string | null {
  const parsed = anonymousProjectIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function projectNotFoundResponse() {
  return NextResponse.json(PROJECT_NOT_FOUND_BODY, {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function projectStoreErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AnonymousProjectNotFoundError) return projectNotFoundResponse();
  if (error instanceof AnonymousProjectLimitError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  if (error instanceof AnonymousProjectVersionConflictError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, {
      status: 409,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  if (error instanceof ShotConfigurationError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({
      error: { code: "INVALID_PROJECT_REQUEST", message: "项目请求参数无效。" }
    }, {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  return null;
}
export async function authorizeOwnedProject(sessionId: string, rawProjectId: string) {
  const projectId = parseOwnedProjectId(rawProjectId);
  if (!projectId) {
    return { authorized: false as const, response: projectNotFoundResponse() };
  }
  try {
    const record = await requireOwnedAnonymousProject(sessionId, projectId);
    return { authorized: true as const, projectId, record };
  } catch {
    return { authorized: false as const, response: projectNotFoundResponse() };
  }
}