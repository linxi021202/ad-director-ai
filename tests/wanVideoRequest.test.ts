import { describe, expect, it } from "vitest";

import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "../lib/prompts/noReadableText";
import { buildWanRequestBody } from "../lib/video/wanVideoClient";

const request = {
  projectId: "coldbrew-demo-001",
  shotId: "shot-5",
  referenceImages: [
    { url: "data:image/png;base64,a2V5ZnJhbWU=", role: "scene" as const },
    { url: "data:image/png;base64,cHJvZHVjdA==", role: "product" as const }
  ],
  prompt: "保持真实产品外观，镜头缓慢推进并稳定结束。",
  aspectRatio: "9:16" as const,
  durationSec: 5
};

describe("Wan 2.7 reference-to-video request", () => {
  it("uses the keyframe as first frame and sends real product references", () => {
    const body = buildWanRequestBody(request, "wan2.7-r2v");

    expect(body.model).toBe("wan2.7-r2v");
    expect(body.input.media).toEqual([
      { type: "first_frame", url: "data:image/png;base64,a2V5ZnJhbWU=" },
      { type: "reference_image", url: "data:image/png;base64,cHJvZHVjdA==" }
    ]);
    expect(body.input.prompt).toContain("真实产品图");
    expect(body.input.prompt).toContain("图1是用户上传的真实产品图");
    expect(body.input.prompt).toContain(NO_READABLE_TEXT_CN);
    expect(body.input.prompt).toContain(NO_READABLE_TEXT_EN);
    expect(body.input.prompt).toContain("Remotion 后期叠加");
    expect(body.input.negative_prompt).toContain("伪文字");
    expect(body.input.negative_prompt).toContain("虚构产品");
    expect(body.parameters).toEqual({
      resolution: "720P",
      ratio: "9:16",
      duration: 5,
      prompt_extend: false,
      watermark: false
    });
  });

  it("keeps generated shot duration within the current 3 to 8 second workflow", () => {
    expect(buildWanRequestBody({ ...request, durationSec: 2 }, "wan2.7-r2v").parameters.duration).toBe(3);
    expect(buildWanRequestBody({ ...request, durationSec: 12 }, "wan2.7-r2v").parameters.duration).toBe(8);
  });
});
