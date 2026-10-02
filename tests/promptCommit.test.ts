const apiSession = vi.hoisted(() => ({ id: "prompt-commit-session" }));
vi.mock("@/lib/session/api", () => ({ getAnonymousApiSession: vi.fn(async () => ({ initialized: true,
  session: { id: apiSession.id, expiresAt: Date.now() + 60_000 } })) }));

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/generate-assets/route";
import * as store from "../lib/projects/anonymousProjectStore";
import * as events from "../lib/projects/generationEvents";
import * as logs from "../lib/logs/modelCallStore";
import { commitFinalPromptBundle, PromptCommitError } from "../lib/prompts/promptCommit";
import { buildShotPromptInputFingerprint } from "../lib/prompts/shotPromptFingerprint";
import { isShotPromptReady } from "../lib/prompts/shotPromptReadiness";
import { deriveShotGenerationState } from "../lib/workflow/shotGenerationState";
import { derivePromptStageProgress } from "../lib/workflow/shotPromptProgress";
import { planShotKeyframeMoments } from "../lib/storyboard/keyframePlan";
import { detailedFramePromptSchema, detailedShotPromptFoundationSchema, detailedShotPromptPackageSchema } from "../lib/schemas/project";
import { expandShotPrompts } from "../lib/providers/deepseekProvider";

const originalEnv = { ...process.env };
let directory = "";
beforeEach(async () => {
  process.env = { ...originalEnv, AI_MODE: "real", ENABLE_REAL_TEXT: "true", DEEPSEEK_API_KEY: "test-key",
    ANONYMOUS_SESSION_OWNERSHIP_SALT: "prompt-commit-test-salt" };
  directory = await mkdtemp(path.join(tmpdir(), "prompt-commit-"));
  process.env.STORAGE_ROOT = directory;
  apiSession.id = randomUUID();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Successful saved prompts must not request a model"); }));
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); store.resetAnonymousProjectQueuesForTests();
  await rm(directory, { recursive: true, force: true }); process.env = { ...originalEnv };
});

async function fixture() {
  const created = await store.createAnonymousProject(apiSession.id, { templateId: "cold-brew-demo" });
  await store.mutateOwnedAnonymousProject(apiSession.id, created.id, (project) => ({ ...project,
    shots: project.shots.map((shot, index) => index === 2 ? { ...shot, id: "shot-03", frames: shot.frames!.slice(0, 3) } : shot) }));
  const record = await store.requireOwnedAnonymousProject(apiSession.id, created.id);
  const shot = record.project.shots[2]!;
  const input = { brief: record.project.brief, strategy: record.project.strategy, shot,
    previousShot: record.project.shots[1], productVisualSpec: record.project.productVisualSpec,
    visualContinuityBible: record.project.visualContinuityBible, referencePack: record.project.referencePack };
  const cn = "单一完整摄影画面，禁止任何可读文字，产品放在桌面右侧，人物视线指向产品，保持包装结构、服装、场景和主光不变。".repeat(15);
  const en = "One complete frozen commercial frame with an exact product, stable character, controlled lighting and a clear hand position. ".repeat(8);
  const strings = (shape: Record<string, unknown>) => Object.fromEntries(Object.keys(shape).map((key) => [key, cn]));
  const foundation = detailedShotPromptFoundationSchema.parse({ ...strings(detailedShotPromptFoundationSchema.shape), shotId: shot.id,
    continuityContext: { product: cn, character: cn, wardrobe: cn, scene: cn, sceneState: cn, previousShotState: cn,
      majorProps: ["办公桌"], immutableElements: ["产品身份不变", "人物身份不变", "场景空间不变"], allowedChanges: ["允许视线变化"] },
    videoPromptCn: `开始状态：人物坐在桌前。0.0s-${shot.durationSec}s，右手靠近产品。结束状态：产品保持桌面直立。${cn}`,
    directingNotesEn: en, videoPromptEn: en, negativePromptEn: en,
    qaChecklist: Array.from({ length: 6 }, (_, index) => `具体校验条件 ${index + 1}`),
    qualityScores: { creativeDepth: 9, visualSpecificity: 9, productConsistency: 9, characterContinuity: 9,
      sceneContinuity: 9, actionExecutability: 9, textRisk: 1, deformationRisk: 1 } });
  const moments = planShotKeyframeMoments(shot);
  const frames = shot.frames!.map((frame, index) => detailedFramePromptSchema.parse({ ...strings(detailedFramePromptSchema.shape),
    frameId: frame.id, timestampSec: moments[index]!.timestampSec, role: frame.role, cameraAngle: "平视",
    frozenMoment: `右手处于第 ${index + 1} 个具体时间锚点，产品停留在桌面右侧，视线追随手部。`,
    handState: `右手处于第 ${index + 1} 个阶段的明确稳定位置`,
    imagePromptCn: `${cn}时间锚点 ${index + 1}`, imagePromptEn: `${en}Moment ${index + 1}.`, negativePromptEn: en,
    continuityConstraints: ["产品结构不变", "人物身份不变", "场景空间不变"],
    forbiddenChanges: ["禁止新增文字", "禁止变更产品", "禁止变更人物"] }));
  const fingerprint = buildShotPromptInputFingerprint(input);
  const draft = { shotId: shot.id, schemaVersion: 2 as const, inputFingerprint: fingerprint, foundation, framePrompts: frames };
  await store.saveOwnedShotPromptDraft(apiSession.id, created.id, draft);
  const bundle = detailedShotPromptPackageSchema.parse({ ...foundation, framePrompts: frames, schemaVersion: 2, inputFingerprint: fingerprint });
  const event = await events.startGenerationEvent(apiSession.id, created.id, { stage: "prompts", provider: "deepseek", shotId: shot.id,
    action: "提交最终提示词", message: "复用已保存的最终结果。" });
  return { record, input, draft, bundle, fingerprint, context: { sessionId: apiSession.id, projectId: created.id,
    shotId: shot.id, taskId: event.id, jobId: event.runId } };
}

it("logs schema rejection as a system validation failure while retaining the successful model response", async () => {
  const data = await fixture();
  await store.saveOwnedShotPromptDraft(apiSession.id, data.record.id, { ...data.draft, framePrompts: data.draft.framePrompts.slice(0, 2) });
  let requests = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    requests++;
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(requests === 1
      ? { ...data.draft.framePrompts[2], cameraAngle: "" } : { cameraAngle: "平视" }) } }] }), { status: 200 });
  }));
  const response = await POST(new Request("http://localhost/api/generate-assets", { method: "POST", body: JSON.stringify({
    projectId: data.record.id, brief: data.record.project.brief, strategy: data.record.project.strategy, shots: [data.record.project.shots[2]], batchSize: 1
  }) }));
  expect(response.status).toBe(200);
  expect(requests).toBe(2);
  const saved = await store.requireOwnedAnonymousProject(apiSession.id, data.record.id);
  expect(isShotPromptReady(saved.project, saved.project.shots[2]!)).toBe(true);
  const entries = await logs.listModelCallLogs(apiSession.id, { projectId: data.record.id });
  const validation = entries.find((entry) => entry.mode === "prompt-stage-validation");
  expect(validation).toMatchObject({ provider: "system", status: "failed", failurePhase: "SCHEMA_VALIDATION_FAILED" });
  expect(entries.find((entry) => entry.mode === "frame" && entry.provider === "deepseek")).toMatchObject({ status: "completed", schemaValid: false });
});

it("stops at a quota-exhausted third frame, keeps two checkpoints, then resumes only that frame", async () => {
  const data = await fixture();
  await store.saveOwnedShotPromptDraft(apiSession.id, data.record.id, { ...data.draft, framePrompts: data.draft.framePrompts.slice(0, 2) });
  let requests = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    requests++;
    return new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "insufficient_balance" } }), { status: 402 });
  }));
  const request = () => new Request("http://localhost/api/generate-assets", { method: "POST", body: JSON.stringify({
    projectId: data.record.id, brief: data.record.project.brief, strategy: data.record.project.strategy,
    shots: [data.record.project.shots[2]], batchSize: 1
  }) });
  const blocked = await POST(request());
  expect(blocked.status).toBe(207);
  expect((await blocked.json()).error).toContain("DeepSeek 额度不足");
  expect(requests).toBe(1);
  const partial = (await store.requireOwnedAnonymousProject(apiSession.id, data.record.id)).project;
  expect(partial.shotPromptDrafts?.find((item) => item.shotId === "shot-03")?.framePrompts).toHaveLength(2);
  expect(partial.generationEvents?.at(-1)).toMatchObject({ status: "failed", errorCode: "DEEPSEEK_QUOTA_EXHAUSTED" });
  const blockedLogs = await logs.listModelCallLogs(apiSession.id, { projectId: data.record.id, limit: 500 });
  expect(blockedLogs.find((item) => item.provider === "deepseek" && item.mode === "frame")).toMatchObject({
    status: "failed", frameId: data.input.shot.frames![2]!.id, httpStatus: 402, errorCode: "DEEPSEEK_QUOTA_EXHAUSTED"
  });
  expect(blockedLogs.find((item) => item.mode === "prompt-stage-validation")).toMatchObject({
    status: "blocked", blockedBy: "DEEPSEEK_QUOTA_EXHAUSTED"
  });
  expect(blockedLogs.filter((item) => item.mode?.includes("repair"))).toHaveLength(0);

  vi.stubGlobal("fetch", vi.fn(async () => {
    requests++;
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify(data.draft.framePrompts[2])
    } }] }), { status: 200 });
  }));
  const resumed = await POST(request());
  expect((await resumed.json()).success).toBe(true);
  expect(requests).toBe(2);
  const ready = (await store.requireOwnedAnonymousProject(apiSession.id, data.record.id)).project;
  expect(isShotPromptReady(ready, ready.shots[2]!)).toBe(true);
  expect(derivePromptStageProgress(ready).shots[2]?.status).toBe("ready");
  expect(ready.shotPromptDrafts?.some((item) => item.shotId === "shot-03")).toBe(false);
});

describe("final prompt commit", () => {
  it("runs shot-03 through the real API to task-completed using saved canonical results, ignoring historical raw failures", async () => {
    const data = await fixture();
    await logs.upsertModelCallLog(apiSession.id, { kind: "call", taskId: data.context.taskId, projectId: data.context.projectId,
      stage: "prompts", provider: "deepseek", mode: "frame-schema-validation", status: "failed", startedAt: Date.now(), finalUsed: false });
    const response = await POST(new Request("http://localhost/api/generate-assets", { method: "POST",
      body: JSON.stringify({ projectId: data.context.projectId, brief: data.record.project.brief, strategy: data.record.project.strategy,
        shots: [data.input.shot], batchSize: 1 }) }));
    const body = await response.json();
    expect(body.success, JSON.stringify(body)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    const refreshed = await store.requireOwnedAnonymousProject(apiSession.id, data.context.projectId);
    expect(isShotPromptReady(refreshed.project, refreshed.project.shots[2]!)).toBe(true);
    expect(deriveShotGenerationState(refreshed.project, "shot-03")).toBe("prompt_ready");
    expect(refreshed.project.generationEvents!.at(-1)!.status).toBe("completed");
    const entries = await logs.listModelCallLogs(apiSession.id, { projectId: data.context.projectId, limit: 500 });
    expect(entries.filter((entry) => entry.mode?.endsWith("canonical-selected"))).toHaveLength(4);
    for (const mode of ["prompt-bundle-building", "prompt-bundle-validated", "prompt-bundle-persisting", "prompt-bundle-persisted",
      "shot-status-updating", "shot-status-ready", "task-completing", "task-completed"]) {
      expect(entries.some((entry) => entry.mode === mode && entry.status === "completed"), mode).toBe(true);
    }
  });

  it("classifies persistence failures and preserves drafts with sanitized internal stack evidence", async () => {
    const data = await fixture();
    const error = new Error("write failed token=super-secret-value", { cause: { code: "EACCES" } });
    vi.spyOn(store, "saveOwnedShotPromptPackage").mockRejectedValueOnce(error);
    await expect(commitFinalPromptBundle(data.context, data.bundle, data.fingerprint)).rejects.toMatchObject({ failurePhase: "PROJECT_PERSIST_FAILED" });
    const entries = await logs.listModelCallLogs(apiSession.id, { projectId: data.context.projectId });
    const failure = entries.find((entry) => entry.mode === "prompt-commit-failed")!;
    expect(failure).toMatchObject({ failurePhase: "PROJECT_PERSIST_FAILED", errorName: "Error", causeCode: "EACCES" });
    expect(failure.errorStack).toContain("write failed");
    expect(JSON.stringify(failure)).not.toContain("super-secret-value");
    expect((await store.requireOwnedAnonymousProject(apiSession.id, data.context.projectId)).project.shotPromptDrafts).toHaveLength(1);
  });

  it("returns a Chinese persistence error from the API instead of a provider error, then resumes without regeneration", async () => {
    const data = await fixture();
    const request = () => new Request("http://localhost/api/generate-assets", { method: "POST", body: JSON.stringify({
      projectId: data.context.projectId, brief: data.record.project.brief, strategy: data.record.project.strategy,
      shots: [data.input.shot], batchSize: 1
    }) });
    vi.spyOn(store, "saveOwnedShotPromptPackage").mockRejectedValueOnce(new Error("atomic rename failed"));
    const failed = await POST(request());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ success: false, trace: { failurePhase: "PROJECT_PERSIST_FAILED" },
      error: "镜头详细提示词保存失败，已生成内容保留，可直接重试保存。" });
    const after = await store.requireOwnedAnonymousProject(apiSession.id, data.context.projectId);
    expect(after.project.generationEvents!.at(-1)).toMatchObject({ status: "failed", errorCode: "PROJECT_PERSIST_FAILED" });
    const retried = await POST(request());
    expect((await retried.json()).success).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a version conflict and retries the same bundle without model calls", async () => {
    const data = await fixture();
    const save = vi.spyOn(store, "saveOwnedShotPromptPackage").mockRejectedValueOnce(new store.AnonymousProjectVersionConflictError());
    await expect(commitFinalPromptBundle(data.context, data.bundle, data.fingerprint)).rejects.toMatchObject({ failurePhase: "VERSION_CONFLICT" });
    save.mockRestore();
    const result = await commitFinalPromptBundle(data.context, data.bundle, data.fingerprint);
    expect(result.bundle).toEqual(data.bundle);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("detects an upstream edit inside the atomic write rather than overwriting it with stale results", async () => {
    const data = await fixture();
    const save = store.saveOwnedShotPromptPackage;
    vi.spyOn(store, "saveOwnedShotPromptPackage").mockImplementationOnce(async (...args) => {
      await store.mutateOwnedAnonymousProject(apiSession.id, data.context.projectId, (project) => ({ ...project,
        shots: project.shots.map((shot) => shot.id === "shot-03" ? { ...shot, goal: "保存前最后一刻的用户更新" } : shot) }));
      return save(...args);
    });
    await expect(commitFinalPromptBundle(data.context, data.bundle, data.fingerprint)).rejects.toMatchObject({ failurePhase: "VERSION_CONFLICT" });
    const project = (await store.requireOwnedAnonymousProject(apiSession.id, data.context.projectId)).project;
    expect(project.shots[2]!.goal).toBe("保存前最后一刻的用户更新");
    expect(project.shotPromptPackages?.some((item) => item.shotId === "shot-03")).not.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a committed task successful when the final telemetry write fails", async () => {
    const data = await fixture();
    const write = logs.upsertModelCallLog;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(logs, "upsertModelCallLog").mockImplementation(async (sessionId, entry) => {
      if (entry.mode === "task-completed") throw new Error("log flush failed");
      return write(sessionId, entry);
    });
    const result = await commitFinalPromptBundle(data.context, data.bundle, data.fingerprint);
    expect(result.warnings).toEqual(["task-completed"]);
    const refreshed = await store.requireOwnedAnonymousProject(apiSession.id, data.context.projectId);
    expect(refreshed.project.generationEvents!.find((event) => event.id === data.context.taskId)!.status).toBe("completed");
    expect(isShotPromptReady(refreshed.project, refreshed.project.shots[2]!)).toBe(true);
  });

  it("preserves saved prompts and classifies a failed task-state transition separately", async () => {
    const data = await fixture();
    vi.spyOn(events, "completeGenerationEvent").mockRejectedValueOnce(new Error("task state write failed"));
    await expect(commitFinalPromptBundle(data.context, data.bundle, data.fingerprint)).rejects.toMatchObject({ failurePhase: "TASK_STATE_TRANSITION_FAILED" });
    const refreshed = await store.requireOwnedAnonymousProject(apiSession.id, data.context.projectId);
    expect(isShotPromptReady(refreshed.project, refreshed.project.shots[2]!)).toBe(true);
  });

  it("rejects missing final frames before persistence or Qwen", async () => {
    const data = await fixture();
    const save = vi.spyOn(store, "saveOwnedShotPromptPackage");
    await expect(commitFinalPromptBundle(data.context, { ...data.bundle, framePrompts: data.bundle.framePrompts.slice(0, 2) }, data.fingerprint))
      .rejects.toBeInstanceOf(PromptCommitError);
    expect(save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("patches the current project without overwriting unrelated concurrent task or upstream changes", async () => {
    const data = await fixture();
    await events.startGenerationEvent(apiSession.id, data.context.projectId, { stage: "keyframes", provider: "qwen-image",
      shotId: data.record.project.shots[0]!.id, action: "其它镜头任务", message: "保持其它镜头。" });
    const saved = await commitFinalPromptBundle(data.context, data.bundle, data.fingerprint);
    expect(saved.record.project.generationEvents).toHaveLength(2);
    await store.mutateOwnedAnonymousProject(apiSession.id, data.context.projectId, (project) => ({ ...project,
      shots: project.shots.map((shot) => shot.id === "shot-03" ? { ...shot, goal: "用户最新确认的镜头目标" } : shot) }));
    await expect(commitFinalPromptBundle(data.context, data.bundle, data.fingerprint)).rejects.toMatchObject({ failurePhase: "VERSION_CONFLICT" });
    expect((await store.requireOwnedAnonymousProject(apiSession.id, data.context.projectId)).project.shots[2]!.goal).toBe("用户最新确认的镜头目标");
  });

  it("returns a final bundle from saved foundation and frames without a new provider request", async () => {
    const data = await fixture();
    const result = await expandShotPrompts(data.input, { resumeShotPromptDraft: data.draft });
    expect(result.success).toBe(true); expect(result.data?.framePrompts).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("commits an already successful checkpoint when a task write fills missing empty asset lists", async () => {
    const data = await fixture();
    const legacyInput = { ...data.input, brief: { ...data.input.brief, productImages: undefined, productAssetIds: undefined } };
    const fingerprint = buildShotPromptInputFingerprint(legacyInput);
    const saved = await commitFinalPromptBundle(data.context, { ...data.bundle, inputFingerprint: fingerprint }, fingerprint);
    expect(isShotPromptReady(saved.record.project, saved.record.project.shots[2]!)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
