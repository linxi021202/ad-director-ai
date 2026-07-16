import { describe, expect, it } from "vitest";
import { buildHappyHorseRequestBody } from "../lib/video/happyHorseClient";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "../lib/prompts/noReadableText";

const request = {
  projectId: "coldbrew-demo-001",
  shotId: "shot-3",
  referenceImages: [
    { url: "data:image/png;base64,cHJvZHVjdA==", role: "product" as const },
    { url: "https://example.test/generated/shot-3.png", role: "scene" as const }
  ],
  prompt: "保持真实产品外观和主体构图，镜头缓慢推进。",
  aspectRatio: "9:16" as const,
  durationSec: 5
};

describe("HappyHorse reference-to-video request", () => {
  it("sends references while forbidding readable model-generated text", () => {
    const body = buildHappyHorseRequestBody(request, "happyhorse-1.0-r2v");
    expect(body.model).toBe("happyhorse-1.0-r2v");
    expect(body.input.media).toEqual([
      { type: "reference_image", url: "data:image/png;base64,cHJvZHVjdA==" },
      { type: "reference_image", url: "https://example.test/generated/shot-3.png" }
    ]);
    expect(body.input.prompt).toContain("[Image 1] 是用户上传的真实产品图");
    expect(body.input.prompt).toContain("[Image 2] 是当前主镜头关键帧");
    expect(body.input.prompt).toContain(NO_READABLE_TEXT_CN);
    expect(body.input.prompt).toContain(NO_READABLE_TEXT_EN);
    expect(body.input.prompt).toContain("Remotion 后期叠加");
    expect(body.parameters).toEqual({ resolution: "720P", ratio: "9:16", duration: 5, watermark: false });
  });

  it("clamps the Hero Shot duration to five seconds", () => {
    const body = buildHappyHorseRequestBody({ ...request, durationSec: 12 }, "happyhorse-1.0-r2v");
    expect(body.parameters.duration).toBe(5);
  });
});
