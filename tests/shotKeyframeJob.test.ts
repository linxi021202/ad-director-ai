import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({ initialized: true as const, session: { id: "shot-job-session" } }))
}));

import { GET as getShotJob, POST as submitShotJob } from "../app/api/shot-keyframes/route";
import { createAnonymousProject, mutateOwnedAnonymousProject, requireOwnedAnonymousProject, resetAnonymousProjectQueuesForTests } from "../lib/projects/anonymousProjectStore";
import { startGenerationEvent } from "../lib/projects/generationEvents";

const originalEnv = { ...process.env };
let storageRoot = "";

beforeEach(async () => {
  process.env = { ...originalEnv, ANONYMOUS_SESSION_OWNERSHIP_SALT: "shot-job-test-salt" };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-shot-job-"));
  process.env.STORAGE_ROOT = storageRoot;
  resetAnonymousProjectQueuesForTests();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("single-shot keyframe job", () => {
  it("reports an orphaned shot job as interrupted instead of polling forever", async () => {
    const created = await createAnonymousProject("shot-job-session");
    const shotId = created.project.shots[0]!.id;
    const event = await startGenerationEvent("shot-job-session", created.id, {
      stage: "keyframes", provider: "system", action: "制作单镜关键帧", shotId, message: "正在制作镜头。"
    });
    await mutateOwnedAnonymousProject("shot-job-session", created.id, (project) => ({
      ...project,
      generationEvents: project.generationEvents.map((item) => item.id === event.id
        ? { ...item, lastHeartbeatAt: Date.now() - 3 * 60_000 } : item)
    }));

    const response = await getShotJob(new Request(`http://localhost/api/shot-keyframes?projectId=${created.id}&eventId=${event.id}`));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ status: "interrupted", eventId: event.id });
  });

  it("rejects generation before storyboard confirmation without starting a task", async () => {
    const created = await createAnonymousProject("shot-job-session", { templateId: "cold-brew-demo" });
    const shotId = created.project.shots[0]!.id;
    const response = await submitShotJob(new Request("http://localhost/api/shot-keyframes", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: created.id, shotId }) }));
    expect(response.status).toBe(409);
    expect((await requireOwnedAnonymousProject("shot-job-session", created.id)).project.generationEvents
      .filter((event) => event.action === "制作单镜关键帧")).toHaveLength(0);
  });

  it("starts one job and submits only the selected shot for prompt preparation", async () => {
    const created = await createAnonymousProject("shot-job-session", { templateId: "cold-brew-demo" });
    const prepared = await mutateOwnedAnonymousProject("shot-job-session", created.id, (project) => ({ ...project,
      stageStates: { ...project.stageStates!, storyboard: { status: "locked", updatedAt: Date.now() } }
    }));
    const shotId = prepared.project.shots[0]!.id;
    const calledShotIds: string[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      expect(new URL(url).pathname).toBe("/api/generate-assets");
      calledShotIds.push((JSON.parse(String(init?.body)) as { shots: Array<{ id: string }> }).shots.map((shot) => shot.id));
      return Response.json({ success: false, error: "准备失败" }, { status: 500 });
    }));
    const response = await submitShotJob(new Request("http://localhost/api/shot-keyframes", { method: "POST",
      headers: { "Content-Type": "application/json", cookie: "ad-director-session=test" },
      body: JSON.stringify({ projectId: created.id, shotId }) }));
    expect(response.status).toBe(202);
    const result = await response.json() as { data: { eventId: string; jobId: string } };
    expect(result.data.eventId).toBeTruthy();
    expect(result.data.jobId).toBeTruthy();
    let event;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      event = (await requireOwnedAnonymousProject("shot-job-session", created.id)).project.generationEvents
        .find((item) => item.id === result.data.eventId);
      if (event?.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(event?.status).toBe("failed");
    expect(event?.shotId).toBe(shotId);
    expect(calledShotIds).toEqual([[shotId]]);
    expect((await requireOwnedAnonymousProject("shot-job-session", created.id)).project.generationEvents
      .filter((item) => item.action === "制作单镜关键帧" && item.shotId !== shotId)).toHaveLength(0);
  });
});
