import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

describe("anonymous project limit navigation", () => {
  it("redirects the server page to project management instead of leaking the limit exception", () => {
    const source = readSource("app/generate/page.tsx");
    expect(source).toContain("error instanceof AnonymousProjectLimitError");
    expect(source).toContain('redirect("/projects?notice=project-limit")');
  });

  it("replaces the create action with project management when the session is full", () => {
    const source = readSource("components/GenerateWorkflow.tsx");
    expect(source).toContain('canCreateProject ? "/generate?new=1" : "/projects?notice=project-limit"');
    expect(source).toContain('canCreateProject ? "新建项目" : "管理项目"');
  });

  it("explains how to free a project slot", () => {
    const source = readSource("app/projects/page.tsx");
    expect(source).toContain('className="project-limit-notice" role="alert"');
    expect(source).toContain("删除一个不再需要的项目后，即可继续创建新项目。");
  });
});
