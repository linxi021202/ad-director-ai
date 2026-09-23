vi.mock("server-only", () => ({}));

const sessionMock = vi.hoisted(() => ({ id: "log-session-a" }));
vi.mock("@/lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({ initialized: true, session: { id: sessionMock.id, expiresAt: Date.now() + 60_000 } }))
}));

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/call-logs/route";
import { GET as exportLogs } from "../app/api/call-logs/export/route";
import { listModelCallLogs, upsertModelCallLog } from "../lib/logs/modelCallStore";
import { createAnonymousProject, requireOwnedAnonymousProject, resetAnonymousProjectQueuesForTests } from "../lib/projects/anonymousProjectStore";

const originalEnv = { ...process.env };
let root = "";
let projectId = "";

beforeEach(async () => {
  process.env = { ...originalEnv };
  root = await mkdtemp(path.join(tmpdir(), "ad-director-call-logs-"));
  process.env.STORAGE_ROOT = root;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "call-logs-test-salt";
  sessionMock.id = "log-session-a";
  resetAnonymousProjectQueuesForTests();
  projectId = (await createAnonymousProject(sessionMock.id, { templateId: "cold-brew-demo" })).id;
});

afterEach(async () => {
  resetAnonymousProjectQueuesForTests();
  await rm(root, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("persistent model call logs", () => {
  it("persists sanitized diagnostics without incrementing the project version", async () => {
    const before = await requireOwnedAnonymousProject(sessionMock.id, projectId);
    const entry = await upsertModelCallLog(sessionMock.id, {
      kind: "call", taskId: randomUUID(), projectId, stage: "prompts", provider: "deepseek",
      status: "failed", startedAt: Date.now(), errorCode: "DEEPSEEK_OUTPUT_TRUNCATED",
      errorSummary: "Authorization: Bearer sk-secretvalue123 https://private.example/file",
      finishReason: "length", outputLength: 5000, schemaValid: false
    });
    const restored = await listModelCallLogs(sessionMock.id, { projectId });
    const after = await requireOwnedAnonymousProject(sessionMock.id, projectId);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: entry.id, errorCode: "DEEPSEEK_OUTPUT_TRUNCATED", finishReason: "length", outputLength: 5000 });
    expect(restored[0]?.errorSummary).not.toContain("sk-secretvalue123");
    expect(restored[0]?.errorSummary).not.toContain("private.example");
    expect(after.version).toBe(before.version);
    const namespace = createHash("sha256").update(sessionMock.id).digest("hex").slice(0, 32);
    const file = await readFile(path.join(root, "sessions", namespace, "model-calls.json"), "utf8");
    expect(file).not.toContain("sk-secretvalue123");
  });

  it("rejects cross-session reads and writes", async () => {
    await upsertModelCallLog(sessionMock.id, {
      kind: "call", taskId: randomUUID(), projectId, stage: "storyboard", provider: "deepseek",
      status: "completed", startedAt: Date.now()
    });
    await expect(listModelCallLogs("log-session-b", { projectId })).rejects.toThrow();
    await expect(upsertModelCallLog("log-session-b", {
      kind: "call", taskId: randomUUID(), projectId, stage: "storyboard", provider: "deepseek",
      status: "completed", startedAt: Date.now()
    })).rejects.toThrow();
    sessionMock.id = "log-session-b";
    const response = await GET(new Request(`http://localhost/api/call-logs?projectId=${projectId}`));
    expect(response.status).toBe(404);
    const ownHistory = await GET(new Request("http://localhost/api/call-logs"));
    expect((await ownHistory.json()).data.entries).toEqual([]);
  });

  it("finds a shot's diagnostics even when newer logs fill the first page", async () => {
    await upsertModelCallLog(sessionMock.id, {
      kind: "call", taskId: randomUUID(), projectId, stage: "prompts", provider: "deepseek",
      shotId: "shot-1", status: "failed", startedAt: Date.now() - 10_000, errorCode: "SCHEMA_VALIDATION_FAILED"
    });
    for (let index = 0; index < 51; index += 1) {
      await upsertModelCallLog(sessionMock.id, {
        kind: "call", taskId: randomUUID(), projectId, stage: "prompts", provider: "deepseek",
        shotId: "shot-2", status: "completed", startedAt: Date.now() + index
      });
    }
    const page = await GET(new Request(`http://localhost/api/call-logs?projectId=${projectId}&limit=50`));
    expect((await page.json()).data.entries).toHaveLength(50);
    const focused = await GET(new Request(`http://localhost/api/call-logs?projectId=${projectId}&shotId=shot-1&limit=1`));
    expect((await focused.json()).data.entries).toMatchObject([{ shotId: "shot-1", errorCode: "SCHEMA_VALIDATION_FAILED" }]);
    sessionMock.id = "log-session-b";
    const unauthorized = await GET(new Request(`http://localhost/api/call-logs?projectId=${projectId}&shotId=shot-1`));
    expect(unauthorized.status).toBe(404);
  });

  it("exports every persisted project entry, not only the first UI page", async () => {
    const taskId = randomUUID();
    for (let index = 0; index < 55; index += 1) {
      await upsertModelCallLog(sessionMock.id, {
        kind: "call", taskId, projectId, stage: "prompts", provider: "deepseek", mode: index ? "foundation-schema-repair" : "foundation",
        shotId: "shot-1", status: index === 0 ? "failed" : "completed", startedAt: Date.now() + index,
        ...(index === 0 ? { errorCode: "SCHEMA_VALIDATION_FAILED", validationPath: "continuityContext.wardrobe",
          validationIssues: [{ path: "continuityContext.wardrobe", code: "too_small", message: "Authorization: Bearer sk-secretvalue123" }],
          errorSummary: "Cookie: session=secret-cookie", requestOptions: { temperature: 0.3, maxTokens: 3200, responseFormat: "json", thinking: "disabled" } } : {})
      });
    }
    const json = await exportLogs(new Request(`http://localhost/api/call-logs/export?projectId=${projectId}&format=json`));
    expect(json.status).toBe(200);
    const report = await json.json() as { schemaVersion: number; entries: Array<{ taskId: string; validationIssues?: unknown[] }>; summary: { total: number }; retention: { limitReached: boolean } };
    expect(report.schemaVersion).toBe(1);
    expect(report.summary.total).toBe(55);
    expect(report.entries[0]).toMatchObject({ taskId, validationIssues: [{ path: "continuityContext.wardrobe" }] });
    expect(JSON.stringify(report)).not.toContain("sk-secretvalue123");
    expect(JSON.stringify(report)).not.toContain("secret-cookie");
    expect(report.retention.limitReached).toBe(false);

    const markdown = await exportLogs(new Request(`http://localhost/api/call-logs/export?projectId=${projectId}&taskId=${taskId}&format=markdown`));
    expect(markdown.status).toBe(200);
    const content = await markdown.text();
    expect(content).toContain("# AdDirector AI 调用诊断报告");
    expect(content).toContain("continuityContext.wardrobe");
    expect(content).toContain("## 三、任务执行时间线");
    expect(content).not.toContain("secret-cookie");
  });

  it("does not export another session's project and separates old interruption span from model latency", async () => {
    await upsertModelCallLog(sessionMock.id, {
      kind: "task", taskId: randomUUID(), projectId, stage: "prompts", provider: "deepseek",
      status: "interrupted", startedAt: Date.now() - 6_262_390, completedAt: Date.now(), durationMs: 6_262_390,
      errorCode: "TASK_INTERRUPTED", message: "任务因服务中断未能继续。"
    });
    const own = await exportLogs(new Request(`http://localhost/api/call-logs/export?projectId=${projectId}&format=json`));
    const report = await own.json() as { entries: Array<{ jobElapsedMs: number; modelCallElapsedMs: number | null }> };
    expect(report.entries[0]?.jobElapsedMs).toBe(6_262_390);
    expect(report.entries[0]?.modelCallElapsedMs).toBeNull();
    sessionMock.id = "log-session-b";
    const other = await exportLogs(new Request(`http://localhost/api/call-logs/export?projectId=${projectId}&format=json`));
    expect(other.status).toBe(404);
  });
});
