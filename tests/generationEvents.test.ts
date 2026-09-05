vi.mock("server-only", () => ({}));

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAnonymousProject,
  mutateOwnedAnonymousProject,
  resetAnonymousProjectQueuesForTests,
  resolveProjectJsonPath
} from "../lib/projects/anonymousProjectStore";
import {
  appendGenerationEvent,
  attachGenerationEventProviderTask,
  completeGenerationEvent,
  listGenerationEvents,
  normalizeInterruptedEvents,
  startGenerationEvent
} from "../lib/projects/generationEvents";
import {
  getLastActiveProjectId,
  setLastActiveProjectId
} from "../lib/projects/anonymousWorkspace";

const SESSION_A = "generation-event-session-a";
const SESSION_B = "generation-event-session-b";
let storageRoot = "";
let projectId = "";
const originalEnv = { ...process.env };

beforeEach(async () => {
  process.env = { ...originalEnv };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-events-"));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "generation-event-test-salt";
  resetAnonymousProjectQueuesForTests();
  projectId = (await createAnonymousProject(SESSION_A, { templateId: "cold-brew-demo" })).id;
});

afterEach(async () => {
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("server generation event persistence", () => {
  it("persists completed events and restores them after the in-memory queue resets", async () => {
    const event = await startGenerationEvent(SESSION_A, projectId, {
      stage: "strategy",
      provider: "deepseek",
      action: "generate-strategy",
      message: "策略生成开始。"
    });
    await completeGenerationEvent(SESSION_A, projectId, event.id, "策略生成完成。", { latencyMs: 120 });

    resetAnonymousProjectQueuesForTests();
    const restored = await listGenerationEvents(SESSION_A, projectId);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: event.id,
      status: "completed",
      latencyMs: 120,
      message: "策略生成完成。"
    });
  });

  it("persists provider task identifiers for asynchronous polling", async () => {
    const event = await startGenerationEvent(SESSION_A, projectId, {
      stage: "hero-shot",
      provider: "wan",
      action: "generate-hero-video",
      message: "Wan 任务提交中。"
    });
    await attachGenerationEventProviderTask(SESSION_A, projectId, event.id, {
      taskId: "wan-task-123",
      requestId: "wan-request-456",
      message: "Wan 任务已提交。"
    });

    resetAnonymousProjectQueuesForTests();
    const [restored] = await listGenerationEvents(SESSION_A, projectId);
    expect(restored).toMatchObject({
      providerTaskId: "wan-task-123",
      providerRequestId: "wan-request-456",
      status: "running"
    });
  });

  it("sanitizes secrets and local paths before writing project.json", async () => {
    await appendGenerationEvent(SESSION_A, projectId, {
      stage: "strategy",
      provider: "deepseek",
      action: "unsafe-message",
      status: "failed",
      message: "Authorization: Bearer secret-token sk-secretvalue123 D:\\private\\file.json",
      errorCode: "UNTRUSTED_CODE"
    });

    const raw = await readFile(resolveProjectJsonPath(SESSION_A, projectId), "utf8");
    expect(raw).not.toContain("secret-token");
    expect(raw).not.toContain("sk-secretvalue123");
    expect(raw).not.toContain("D:\\private");
    expect(raw).not.toContain("UNTRUSTED_CODE");
  });

  it("does not lose concurrent Qwen shot events", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      appendGenerationEvent(SESSION_A, projectId, {
        stage: "keyframes",
        provider: "qwen-image",
        action: "generate-shot",
        status: "completed",
        message: `镜头 ${index + 1} 关键帧完成。`,
        shotId: `shot-${index + 1}`
      })
    ));
    const events = await listGenerationEvents(SESSION_A, projectId);
    expect(events).toHaveLength(8);
    expect(new Set(events.map((event) => event.id)).size).toBe(8);
  });

  it("isolates events and workspace state by anonymous session", async () => {
    await appendGenerationEvent(SESSION_A, projectId, {
      stage: "brief",
      provider: "system",
      action: "brief-ready",
      status: "completed",
      message: "简报已就绪。"
    });
    await expect(listGenerationEvents(SESSION_B, projectId)).rejects.toThrow();
    expect(await getLastActiveProjectId(SESSION_A)).toBe(projectId);
    expect(await getLastActiveProjectId(SESSION_B)).toBeUndefined();
  });

  it("marks stale running events as interrupted", async () => {
    const event = await startGenerationEvent(SESSION_A, projectId, {
      stage: "brief",
      provider: "system",
      action: "stale-task",
      message: "任务运行中。"
    });
    await mutateOwnedAnonymousProject(SESSION_A, projectId, (project) => ({
      ...project,
      generationEvents: project.generationEvents.map((item) =>
        item.id === event.id ? { ...item, startedAt: Date.now() - 6 * 60_000 } : item
      )
    }));

    await normalizeInterruptedEvents(SESSION_A, projectId);
    const [restored] = await listGenerationEvents(SESSION_A, projectId);
    expect(restored?.status).toBe("interrupted");
    expect(restored?.errorCode).toBe("TASK_INTERRUPTED");
  });

  it("restores and replaces the last active project explicitly", async () => {
    const second = await createAnonymousProject(SESSION_A, { templateId: "cold-brew-demo" });
    await setLastActiveProjectId(SESSION_A, projectId);
    expect(await getLastActiveProjectId(SESSION_A)).toBe(projectId);
    await setLastActiveProjectId(SESSION_A, second.id);
    expect(await getLastActiveProjectId(SESSION_A)).toBe(second.id);
  });
});
