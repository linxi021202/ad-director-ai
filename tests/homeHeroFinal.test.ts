import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const styles = readFileSync("app/home-final.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const backdrop = readFileSync("components/SiteVideoBackdrop.tsx", "utf8");
const cinemaStyles = readFileSync("app/cinema-system.css", "utf8");

describe("homepage final hero", () => {
  it("routes anonymous visitors directly to public product pages", () => {
    expect(page).toContain('const workspaceTarget = "/generate"');
    expect(page).toContain('const projectPath = "/demo/project"');
    expect(page).toContain('href={projectTarget}');
    expect(page).not.toContain("/sign-in");
    expect(page).not.toContain("/sign-up");
  });

  it("keeps the public model settings entry", () => {
    expect(page).toContain("ModelSettingsTrigger");
    expect(page).toContain("模型设置");
    expect(page).toContain("打开工作台");
  });

  it("includes responsive navigation and reduced-motion support", () => {
    expect(page).toContain("home-menu-button");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain("min-height: 100dvh");
  });

  it("keeps the cover copy to one short sentence", () => {
    expect(page).toContain("一份简报，直接成片。");
    expect(page).not.toContain("从策略、分镜到关键帧与成片");
    expect(page).not.toContain("home-features");
  });

  it("uses one persistent full-screen video scene across product pages", () => {
    expect(layout).toContain("SiteVideoBackdrop");
    expect(layout).toContain("general-sans@400,500,600");
    expect(backdrop).toContain("hf_20260217_030345_246c0224-10a4-422c-b324-070b7c0eceda.mp4");
    expect(backdrop).toContain("autoPlay loop muted playsInline");
    expect(cinemaStyles).toContain("site-video-backdrop__overlay");
    expect(cinemaStyles).toContain("prefers-reduced-motion: reduce");
    expect(backdrop).not.toContain("UnicornScene");
  });
});
