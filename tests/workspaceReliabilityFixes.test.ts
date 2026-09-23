import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const generateWorkflow = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const projectDetail = readFileSync("components/ProjectDetailView.tsx", "utf8");
const cinemaCss = readFileSync("app/cinema-system.css", "utf8");
const workspaceCss = readFileSync("app/workspace-v3.css", "utf8");

describe("workspace reliability fixes", () => {
  it("keeps custom-call cards readable in their active state", () => {
    expect(cinemaCss).toContain(".site-body .ad-call-toggle.is-active");
    expect(cinemaCss).toContain(".site-body .ad-call-toggle strong { color: #fff !important; }");
    expect(cinemaCss).toContain(".site-body .ad-call-toggle small { color: rgba(255, 255, 255, .62) !important; }");
  });

  it("updates generated media frames from the live aspect-ratio draft", () => {
    expect(generateWorkflow).toContain("const previewProject = useMemo<GenerationProject>");
    expect(generateWorkflow).toContain("aspectRatio: briefDraft.brief.aspectRatio");
    expect(generateWorkflow).toContain("<KeyframeStageWorkspace project={previewProject}");
  });

  it("keeps Wan selectable and moves the video library after final composition", () => {
    expect(generateWorkflow).toContain('title="Wan 2.7 视频"');
    expect(generateWorkflow).toContain('toggleSelection("wan")');
    expect(generateWorkflow).not.toContain('badge="项目页操作"');
    expect(generateWorkflow).not.toContain("项目页上传主镜头视频");
    expect(projectDetail).toContain("不限制原视频时长和比例");
    expect(projectDetail).toContain("导入完整广告视频");
    expect(projectDetail).toContain('id="video-library-title"');
    expect(projectDetail.indexOf('id="video-library-title"')).toBeGreaterThan(projectDetail.indexOf('id="project-final"'));
    expect(projectDetail).not.toContain("visual-continuity-v5");
    expect(projectDetail).not.toContain("使用本地演示视频");
    expect(projectDetail).not.toContain("旁白音轨");
  });

  it("removes platform metadata and centers the project workflow", () => {
    expect(projectDetail).not.toContain('MetaItem label="平台"');
    expect(projectDetail).not.toContain("platformLabel(");
    expect(workspaceCss).toContain("justify-items: center; text-align: center;");
    expect(workspaceCss).toContain("justify-content: center;");
  });
});
