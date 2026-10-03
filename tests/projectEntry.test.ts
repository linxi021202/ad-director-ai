vi.mock("server-only", () => ({}));
const currentSession = vi.hoisted(() => ({ id: "entry-session" }));
vi.mock("@/lib/session/api", () => ({ getAnonymousApiSession: vi.fn(async () => ({
  initialized: true, session: { id: currentSession.id }
})) }));

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET as listProjects } from "../app/api/projects/route";
import { DELETE as deleteProject } from "../app/api/projects/[projectId]/route";
import { createAnonymousProject, listAnonymousProjects, updateOwnedAnonymousProject } from "../lib/projects/anonymousProjectStore";
import { getLastActiveProjectId, setLastActiveProjectId } from "../lib/projects/anonymousWorkspace";

const originalEnv = { ...process.env };
let root = "";
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "project-entry-"));
  process.env.STORAGE_ROOT = root;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "project-entry-test";
  currentSession.id = "entry-session";
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); process.env = { ...originalEnv }; });

describe("project entry", () => {
  it("lists only owned project summaries, newest first", async () => {
    const first = await createAnonymousProject(currentSession.id, { name: "项目一" });
    const second = await createAnonymousProject(currentSession.id, { name: "项目二" });
    const third = await createAnonymousProject(currentSession.id, { name: "项目三" });
    await updateOwnedAnonymousProject(currentSession.id, first.id, { status: "ready" });
    await createAnonymousProject("another-session", { name: "其它会话" });
    const response = await listProjects(new Request("http://localhost/api/projects?summary=1"));
    const result = await response.json() as { data: { projects: Array<{ projectId: string; name: string; updatedAt: number }> } };
    expect(result.data.projects).toHaveLength(3);
    expect(result.data.projects.map((item) => item.projectId)).toEqual([first.id, third.id, second.id]);
    expect(result.data.projects.map((item) => item.name)).not.toContain("其它会话");
    expect(JSON.stringify(result.data.projects)).not.toContain("apiKey");
    expect(JSON.stringify(result.data.projects)).not.toContain("shots");
  });

  it("clears active project selection when deleting it without selecting another", async () => {
    const first = await createAnonymousProject(currentSession.id, { name: "当前项目" });
    await createAnonymousProject(currentSession.id, { name: "保留项目" });
    await setLastActiveProjectId(currentSession.id, first.id);
    const response = await deleteProject(new Request(`http://localhost/api/projects/${first.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ projectId: first.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data.wasActive).toBe(true);
    expect(await getLastActiveProjectId(currentSession.id)).toBeUndefined();
    expect(await listAnonymousProjects(currentSession.id)).toHaveLength(1);
  });
});
