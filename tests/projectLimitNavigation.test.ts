import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

describe("anonymous project limit navigation", () => {
  it("does not create projects during GET page rendering", () => {
    const source = readSource("app/generate/page.tsx");
    expect(source).not.toContain("createAnonymousProject(");
    expect(source).toContain("<ProjectEntryPage");
  });

  it("replaces the create action with project management when the session is full", () => {
    const source = readSource("components/GenerateWorkflow.tsx");
    expect(source).toContain('href="/projects?notice=project-limit"');
    expect(source).toContain('canCreateProject ? <button type="button" className="workspace-new-project" onClick={openProjectEntry}>新建项目</button>');
    expect(source).toContain('className="workspace-new-project">管理项目</Link>');
  });

  it("explains how to free a project slot", () => {
    const source = readSource("app/projects/page.tsx");
    expect(source).toContain('className="project-limit-notice" role="alert"');
    expect(source).toContain("删除一个不再需要的项目后，即可继续创建新项目。");
  });
});
