import { describe, expect, it } from "vitest";

import { getInternalRenderOrigin } from "../lib/render/internalOrigin";

describe("Remotion internal asset origin", () => {
  it("always uses loopback HTTP inside the render container", () => {
    expect(getInternalRenderOrigin({ PORT: "3001" })).toBe("http://127.0.0.1:3001");
  });

  it("never constructs HTTPS localhost from proxy headers", () => {
    const origin = getInternalRenderOrigin({ PORT: "3000" });
    expect(origin).toBe("http://127.0.0.1:3000");
    expect(origin).not.toContain("https://localhost");
  });

  it("falls back safely when PORT is invalid", () => {
    expect(getInternalRenderOrigin({ PORT: "invalid" })).toBe("http://127.0.0.1:3000");
  });
});
