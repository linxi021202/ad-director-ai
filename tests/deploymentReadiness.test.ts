import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getRenderState, setRenderState } from "../lib/render/renderStateStore";

const previousStorageRoot = process.env.STORAGE_ROOT;

afterEach(() => {
  if (previousStorageRoot === undefined) delete process.env.STORAGE_ROOT;
  else process.env.STORAGE_ROOT = previousStorageRoot;
});

describe("production deployment readiness", () => {
  it("stores render state below the configured persistent storage root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ad-director-deploy-"));
    const projectId = `deployment-${Date.now()}`;
    process.env.STORAGE_ROOT = root;
    try {
      await setRenderState(projectId, {
        status: "queued",
        progress: 0.01,
        stage: "等待启动渲染引擎"
      });
      const persisted = JSON.parse(await readFile(
        path.join(root, "render-state", `${projectId}.render.json`),
        "utf8"
      ));
      expect(persisted.status).toBe("queued");
      expect((await getRenderState(projectId)).status).toBe("queued");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ships a Chromium-backed container without embedding provider keys", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    const dockerIgnore = await readFile(".dockerignore", "utf8");
    expect(dockerfile).toContain("chromium");
    expect(dockerfile).toContain("REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).not.toMatch(/(?:DEEPSEEK|DASHSCOPE|HAPPYHORSE)_API_KEY=/);
    expect(dockerIgnore).toContain(".env.*");
    expect(dockerIgnore).toContain("public/uploads");
    expect(dockerIgnore).toContain("public/generated");
  });

  it("documents single-instance deployment and bounded rendering", async () => {
    const deploymentGuide = await readFile("docs/DEPLOY_RAILWAY.md", "utf8");
    const renderManager = await readFile("lib/render/renderManager.ts", "utf8");
    expect(deploymentGuide).toContain("Replicas: exactly `1`");
    expect(deploymentGuide).toContain("/app/storage");
    expect(renderManager).toContain('positiveIntegerEnv("MAX_CONCURRENT_RENDERS", 1, 4)');
    expect(renderManager).toContain('positiveIntegerEnv("MAX_RENDER_QUEUE_SIZE", 6, 30)');
  });

  it("keeps public demo fallbacks outside ignored runtime output folders", async () => {
    const components = await Promise.all([
      "components/GenerateWorkflow.tsx",
      "components/ProjectDetailView.tsx",
      "components/StoryboardCard.tsx"
    ].map((file) => readFile(file, "utf8")));
    expect(components.join("\n")).not.toContain("/generated/images/coldbrew-demo-001");
    for (const shot of [2, 3, 4]) {
      expect((await stat(`public/demo-keyframes/shot-${shot}.png`)).size).toBeGreaterThan(1024);
    }
  });

  it("retires the database-backed auth endpoint from the anonymous runtime", async () => {
    const authRoute = await readFile("app/api/auth/[...all]/route.ts", "utf8");
    expect(authRoute).not.toContain("better-auth");
    expect(authRoute).not.toContain("@/lib/auth");
    expect(authRoute).toContain("status: 410");
  });
});
