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
});
