import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const styles = readFileSync("app/home-final.css", "utf8");

describe("homepage final hero", () => {
  it("routes authenticated users directly and anonymous users through sign-in", () => {
    expect(page).toContain('const workspaceTarget = isAuthenticated ? "/generate"');
    expect(page).toContain('"/sign-in?callbackUrl=%2Fgenerate"');
    expect(page).toContain('const projectPath = "/projects/coldbrew-demo-001"');
    expect(page).toContain('href="/demo"');
    expect(page).not.toContain('href="#features"');
  });

  it("renders the final hierarchy and calls to action", () => {
    expect(page).toContain("从一份商品简报，");
    expect(page).toContain("生成</strong>一支完整广告片。");
    expect(page).toContain("开始生成广告");
    expect(page).toContain("查看演示项目");
  });

  it("includes responsive navigation and reduced-motion support", () => {
    expect(page).toContain("home-menu-button");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain("min-height: 100dvh");
  });
});