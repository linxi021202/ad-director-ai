import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const styles = readFileSync("app/home-final.css", "utf8");
const sheet = readFileSync("components/ModelSettingsSheet.tsx", "utf8");

describe("home hero and model settings", () => {
  it("keeps the staged hero at the requested responsive scale", () => {
    expect(page).toContain("从产品图片到成片，让广告生成更稳定、更好改");
    expect(styles).toContain("clamp(42px, 4.2vw, 62px)");
    expect(styles).toContain("text-wrap: balance");
  });

  it("uses compact layered pill CTAs", () => {
    expect(styles).toContain("border-radius: 999px");
    expect(styles).toContain("min-width: 168px");
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain(".home-primary-action::before");
    expect(page).not.toContain("home-secondary-action");
  });

  it("places model settings in the header and never persists keys in browser storage", () => {
    expect(page).toContain("模型设置");
    expect(page).toContain("ModelSettingsSheet");
    expect(sheet).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(sheet).toContain('type={visible[provider.id] ? "text" : "password"}');
  });
});
