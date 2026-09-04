import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const styles = readFileSync("app/home-final.css", "utf8");
const sheet = readFileSync("components/ModelSettingsSheet.tsx", "utf8");

describe("home hero and model settings", () => {
  it("keeps the single-line hero at the requested responsive scale", () => {
    expect(page).toContain("一份简报，直接成片。");
    expect(styles).toContain("clamp(48px, 5vw, 72px)");
    expect(styles).toContain("gap: 40px");
  });

  it("uses compact layered pill CTAs", () => {
    expect(styles).toContain("border-radius: 999px");
    expect(styles).toContain("min-width: 188px");
    expect(styles).toContain("min-height: 48px");
    expect(styles).toContain(".home-primary-action::before");
  });

  it("places model settings in the header and never persists keys in browser storage", () => {
    expect(page).toContain("模型设置");
    expect(page).toContain("ModelSettingsSheet");
    expect(sheet).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(sheet).toContain('type={visible[provider.id] ? "text" : "password"}');
  });
});
