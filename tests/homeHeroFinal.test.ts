import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const styles = readFileSync("app/home-final.css", "utf8");
const unicornBackground = readFileSync("components/UnicornHeroBackground.tsx", "utf8");

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

  it("uses the published Unicorn scene with responsive quality and a local fallback", () => {
    expect(page).toContain("UnicornHeroBackground");
    expect(unicornBackground).toContain('from "unicornstudio-react/next"');
    expect(unicornBackground).toContain('projectId="KJp4lTw9pzaADDxFO3qB"');
    expect(unicornBackground).toContain("scale={isCompact ? 0.72 : 1}");
    expect(unicornBackground).toContain('setSceneState("fallback")');
  });
});
