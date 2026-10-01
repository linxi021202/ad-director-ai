import { afterEach, describe, expect, it, vi } from "vitest";
import { pollProjectKeyframes } from "../lib/image/keyframeGenerationClient";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("keyframe job polling", () => {
  it("reconnects after more than twelve transport failures without marking the job failed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout });
    const connection: boolean[] = [];
    let requests = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      requests += 1;
      if (requests <= 13) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ success: true, data: requests === 14
        ? { status: "running", eventId: "job", images: [] }
        : { status: "completed", eventId: "job", images: [{ shotId: "shot-02", frameId: "frame-2", status: "ready" }] } }),
      { status: requests === 14 ? 202 : 200, headers: { "content-type": "application/json" } });
    }));
    const promise = pollProjectKeyframes("project", "job", undefined, (reconnecting) => connection.push(reconnecting));
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(requests).toBe(15);
    expect(result.status).toBe("completed");
    expect(connection).toContain(true);
    expect(connection.at(-1)).toBe(false);
  });
});
