import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { creativeDirectionToBible, creativeDirectionToStrategy } from "@/lib/creative/creativeDirections";
import { parseOwnedProjectId, projectNotFoundResponse, projectStoreErrorResponse, publicAnonymousProject } from "@/lib/projects/api";
import { completeGenerationEvent, failGenerationEvent, startGenerationEvent } from "@/lib/projects/generationEvents";
import { AnonymousProjectVersionConflictError, mutateOwnedAnonymousProject, requireOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import { resolveProjectPlanningConstraints } from "@/lib/projects/planningConstraints";
import { generateCreativeDirectionSet } from "@/lib/providers/deepseekProvider";
import type { CreativeCandidateSet, GenerationProject } from "@/lib/schemas/project";
import { getAnonymousApiSession } from "@/lib/session/api";
import { lockStageInProject, setStageStatusInProject } from "@/lib/workflow/stageGates";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("select"), expectedVersion: z.number().int().positive(), candidateId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("confirm"), expectedVersion: z.number().int().positive(), candidateId: z.string().min(1) }).strict()
]);

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const projectId = parseOwnedProjectId((await context.params).projectId);
  if (!projectId) return projectNotFoundResponse();

  try {
    const body = requestSchema.parse(await request.json());
    const current = await requireOwnedAnonymousProject(sessionResult.session.id, projectId);
    if (current.version !== body.expectedVersion) throw new AnonymousProjectVersionConflictError();
    if (body.action === "generate") return generateSet(sessionResult.session.id, projectId, current.project);

    const saved = await mutateOwnedAnonymousProject(sessionResult.session.id, projectId, (project) => {
      const set = currentCreativeSet(project);
      const candidate = set?.candidates.find((item) => item.id === body.candidateId);
      if (!set || !candidate) throw new Error("CREATIVE_CANDIDATE_NOT_FOUND");
      const sets = project.creativeWorkspace!.sets.map((item) => item.id === set.id
        ? { ...item, selectedCandidateId: candidate.id, ...(body.action === "confirm" ? { confirmedCandidateId: candidate.id } : {}) }
        : item);
      let next: GenerationProject = {
        ...project,
        creativeWorkspace: { ...project.creativeWorkspace!, sets, updatedAt: new Date().toISOString() }
      };
      if (body.action === "confirm") {
        next = {
          ...next,
          strategy: creativeDirectionToStrategy(candidate, project.brief),
          creativeBible: creativeDirectionToBible(candidate, project.brief)
        };
        next = lockStageInProject(next, "creative");
      }
      return next;
    }, body.expectedVersion);
    return NextResponse.json({ success: true, data: publicAnonymousProject(saved) });
  } catch (error) {
    const storeError = projectStoreErrorResponse(error);
    if (storeError) return storeError;
    const message = error instanceof Error ? error.message : "创意候选更新失败。";
    const notFound = message === "CREATIVE_CANDIDATE_NOT_FOUND";
    return NextResponse.json({ success: false, data: null, error: notFound ? "这个创意候选不存在或已经过期。" : message }, { status: notFound ? 404 : 500 });
  }
}

async function generateSet(sessionId: string, projectId: string, project: GenerationProject) {
  if (project.stageStates?.brief.status !== "locked") {
    return NextResponse.json({ success: false, data: null, error: "请先保存并确认广告需求。" }, { status: 409 });
  }
  const event = await startGenerationEvent(sessionId, projectId, {
    stage: "creative",
    provider: "deepseek",
    action: "生成创意候选",
    message: "正在生成三套不同的广告创意方向。",
    progressCurrent: 0,
    progressTotal: 3
  });
  const result = await generateCreativeDirectionSet(project.brief, resolveProjectPlanningConstraints(project), {
    sessionId,
    maxProviderAttempts: 2
  });
  if (!result.success || !result.data) {
    await failGenerationEvent(sessionId, projectId, event.id, "创意候选生成失败，请检查模型配置后重试。", "CREATIVE_GENERATION_FAILED");
    await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => setStageStatusInProject(latest, "creative", "failed"));
    return NextResponse.json({ success: false, data: null, error: result.error ?? "创意候选生成失败，请重试。" }, { status: 502 });
  }

  const recommendedIndex = Math.max(0, result.data.candidates.findIndex((item) => item.id === result.data!.recommendedCandidateId));
  const candidates = result.data.candidates.map((candidate) => ({ ...candidate, id: randomUUID() }));
  const now = new Date().toISOString();
  const set: CreativeCandidateSet = {
    id: randomUUID(),
    version: (project.creativeWorkspace?.sets.at(-1)?.version ?? 0) + 1,
    candidates,
    recommendedCandidateId: candidates[recommendedIndex]!.id,
    createdAt: now
  };
  await mutateOwnedAnonymousProject(sessionId, projectId, (latest) => setStageStatusInProject({
    ...latest,
    creativeWorkspace: {
      sets: [...(latest.creativeWorkspace?.sets ?? []), set].slice(-12),
      currentSetId: set.id,
      updatedAt: now
    }
  }, "creative", "ready"));
  await completeGenerationEvent(sessionId, projectId, event.id, "三套创意方向已生成，等待选择确认。", {
    status: "completed",
    progressCurrent: 3,
    progressTotal: 3,
    latencyMs: result.latencyMs
  });
  const final = await requireOwnedAnonymousProject(sessionId, projectId);
  return NextResponse.json({ success: true, data: publicAnonymousProject(final) });
}

function currentCreativeSet(project: GenerationProject) {
  return project.creativeWorkspace?.sets.find((set) => set.id === project.creativeWorkspace?.currentSetId);
}
