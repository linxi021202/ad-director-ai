import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const transition = readFileSync("components/ParticleTransitionOverlay.tsx", "utf8");
const workspace = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const workspaceStyles = readFileSync("app/workspace-v3.css", "utf8");
const styles = readFileSync("app/home-final.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const backdrop = readFileSync("components/SiteVideoBackdrop.tsx", "utf8");
const cinemaStyles = readFileSync("app/cinema-system.css", "utf8");

describe("homepage final hero", () => {
  it("routes anonymous visitors directly to public product pages", () => {
    expect(page).toContain('const workspaceTarget = "/generate"');
    expect(page).not.toContain('const projectPath = "/demo/project"');
    expect(page).not.toContain("查看演示项目");
    expect(page).not.toContain(">项目</Link>");
    expect(page).not.toContain("/sign-in");
    expect(page).not.toContain("/sign-up");
  });

  it("keeps the public model settings entry", () => {
    expect(page).toContain("ModelSettingsTrigger");
    expect(page).toContain("模型设置");
    expect(page).toContain("打开工作台");
    expect(page.match(/打开工作台/g)).toHaveLength(1);
    expect(page).not.toContain('className="home-desktop-nav"');
  });

  it("includes responsive navigation and reduced-motion support", () => {
    expect(page).toContain("home-menu-button");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain("min-height: 100dvh");
    expect(page).toContain("ParticleTransitionOverlay");
    expect(page).not.toContain("transitionParticles.map");
    expect(transition).toContain("Math.min(460, Math.max(240");
    expect(transition).toContain("Math.min(220, Math.max(110");
    expect(transition).toContain("Math.min(window.devicePixelRatio || 1, 2)");
    expect(transition).toContain("particle.depth");
    expect(transition).toContain("window.cancelAnimationFrame(frame)");
    expect(transition).toContain('window.removeEventListener("resize", resize)');
    expect(page).toContain("1020");
    expect(page).toContain("1600");
    expect(page).toContain("router.prefetch");
    expect(page).toContain("ad-director-workspace-reveal");
    expect(workspace).toContain("ad-director-workspace-reveal");
    expect(workspaceStyles).toContain("workspace-route-reveal 320ms");
    expect(styles).toContain("home-transition-core-field");
    expect(styles).toContain("home-transition-bloom");
    expect(styles).toContain("home-route-transition__ring--middle");
    expect(styles).not.toContain("home-route-transition__core {");
  });

  it("explains the staged generation flow on the homepage", () => {
    expect(page).toContain("上传商品，一键成片");
    expect(page).toContain("开始制作广告");
    expect(page).not.toContain("home-hero-summary");
    for (const label of ["添加产品图片", "选择创意方向", "确认人物与场景", "制作分镜与视频"]) expect(page).toContain(label);
    expect(page).toContain("制作流程");
    expect(page).not.toContain("从策略、分镜到关键帧与成片");
    expect(page).not.toContain("home-features");
  });

  it("uses one persistent full-screen video scene across product pages", () => {
    expect(layout).toContain("SiteVideoBackdrop");
    expect(layout).toContain("general-sans@400,500,600");
    expect(backdrop).toContain("hf_20260217_030345_246c0224-10a4-422c-b324-070b7c0eceda.mp4");
    expect(backdrop).toContain("autoPlay loop muted playsInline");
    expect(backdrop).toContain('pathname === "/" ? " is-home"');
    expect(cinemaStyles).toContain("site-video-backdrop__overlay");
    expect(cinemaStyles).toContain("object-position: center top");
    expect(cinemaStyles).toContain("prefers-reduced-motion: reduce");
    expect(backdrop).not.toContain("UnicornScene");
  });

  it("keeps the cover responsive without affecting product pages", () => {
    expect(styles).toContain("text-wrap: balance");
    expect(styles).toContain("font-size: 30px");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(cinemaStyles).toContain(".site-video-backdrop.is-home");
  });
});
