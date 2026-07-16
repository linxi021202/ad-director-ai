import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const styles = readFileSync("app/home-api-settings.css", "utf8");
const sheet = readFileSync("components/ModelSettingsSheet.tsx", "utf8");

describe("home hero and model settings", () => {
  it("keeps the hero at the requested type scale and spacing", () => {
    expect(styles).toContain("clamp(46px,4.4vw,68px)");
    expect(styles).toContain("clamp(60px,5.7vw,88px)");
    expect(styles).toContain("margin-top:76px");
  });

  it("uses equal three-column CTA geometry", () => {
    expect(styles).toContain("width:238px");
    expect(styles).toContain("height:58px");
    expect(styles).toContain("grid-template-columns:24px 1fr 24px");
  });

  it("places model settings in the header and never persists keys in browser storage", () => {
    expect(page).toContain("模型设置");
    expect(page).toContain("ModelSettingsSheet");
    expect(sheet).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(sheet).toContain('type={visible[provider.id] ? "text" : "password"}');
  });
});
