import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = "components/ProjectDetailView.tsx";
const routePath = "app/api/projects/[projectId]/render/route.ts";

describe("project render request wiring", () => {
  it("submits the current project, hero shot and keyframe manifest", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain('headers: { "Content-Type": "application/json" }');
    expect(source).toContain("project: { ...displayProject, heroShotId }");
    expect(source).toContain("keyframes");
  });

  it("returns specific validation messages instead of a generic startup error", async () => {
    const source = await readFile(routePath, "utf8");

    expect(source).toContain("渲染请求缺少项目与关键帧数据");
    expect(source).toContain("项目数据不完整");
    expect(source).toContain("关键帧清单格式无效");
  });
});