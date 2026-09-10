vi.mock("server-only", () => ({}));

import { describe, expect, it, vi } from "vitest";
import { buildQwenImageRequestBody } from "../lib/image/qwenImageClient";
import { buildWanRequestBody } from "../lib/video/wanVideoClient";

describe("per-frame provider contracts", () => {
  it("forces one Qwen output per frame request", () => {
    const body = buildQwenImageRequestBody({ prompt: "one frozen product moment" }, "qwen-image", "1024*1792", { promptExtend: false, watermark: false });
    expect(body.parameters.n).toBe(1);
    expect(body.input.messages).toHaveLength(1);
  });

  it("sends first and last frames as independent Wan media entries", () => {
    const body = buildWanRequestBody({
      projectId: "project", shotId: "shot", aspectRatio: "9:16", durationSec: 5, prompt: "one screen only",
      referenceImages: [
        { role: "scene", url: "data:image/png;base64,Zmlyc3Q=" },
        { role: "last-frame", url: "data:image/png;base64,bGFzdA==" }
      ]
    }, "wan2.7-i2v");
    expect(body.input.media).toEqual([
      { type: "first_frame", url: "data:image/png;base64,Zmlyc3Q=" },
      { type: "last_frame", url: "data:image/png;base64,bGFzdA==" }
    ]);
  });
});
