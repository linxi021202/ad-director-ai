import { describe, expect, it } from "vitest";
import { acquireViewportOverlay } from "../components/workspace/viewportOverlayStack";

describe("shared viewport overlay stack", () => {
  it("keeps the background locked when overlapping panels close out of order", () => {
    const document = { body: { style: { overflow: "auto" } } };
    const logs = acquireViewportOverlay(document);
    const guide = acquireViewportOverlay(document);
    const shot = acquireViewportOverlay(document);
    expect(shot.layer).toBeGreaterThan(guide.layer);
    expect(guide.layer).toBeGreaterThan(logs.layer);
    expect(logs.isTop()).toBe(false); expect(shot.isTop()).toBe(true);
    guide.release(); logs.release();
    expect(document.body.style.overflow).toBe("hidden");
    shot.release(); expect(document.body.style.overflow).toBe("auto");
  });
  it("gives keyboard ownership back to the prior panel and releases each lock only once", () => {
    const document = { body: { style: { overflow: "" } } };
    const first = acquireViewportOverlay(document); const second = acquireViewportOverlay(document);
    second.release(); second.release();
    expect(first.isTop()).toBe(true); expect(document.body.style.overflow).toBe("hidden");
    first.release(); expect(document.body.style.overflow).toBe("");
  });
});
