import { describe, expect, it } from "vitest";

import { buildWanRequestBody } from "../lib/video/wanVideoClient";

const request = {
  projectId: "coldbrew-demo-001",
  shotId: "shot-5",
  referenceImages: [
    { url: "data:image/png;base64,a2V5ZnJhbWU=", role: "scene" as const }
  ],
  prompt: "保持真实产品外观，镜头缓慢推进并稳定结束。",
  aspectRatio: "9:16" as const,
  durationSec: 5
};

describe("Wan 2.7 image-to-video request", () => {
  it("sends exactly one complete keyframe as the first frame", () => {
    const body = buildWanRequestBody(request, "wan2.7-i2v");

    expect(body.model).toBe("wan2.7-i2v");
    expect(body.input.media).toEqual([
      { type: "first_frame", url: "data:image/png;base64,a2V5ZnJhbWU=" }
    ]);
    expect(body.input.prompt).toContain("输入只有一张完整主镜头关键帧");
    expect(body.input.prompt).toContain("只生成一个连续的全画幅单镜头视频");
    expect(body.input.prompt).toContain("timed sequence of simple micro-actions");
    expect(body.input.prompt).not.toContain("三个清晰节拍");
    expect(body.input.prompt).not.toContain("自然切镜");
    expect(body.input.prompt).toContain("画面其他位置不得出现任何可读文字");
    expect(body.input.prompt).toContain("preserve original product-label pixels");
    expect(body.input.prompt).toContain("不得由模型重写");
    expect(body.input.prompt).toContain("禁字要求优先级最高");
    expect(body.input.prompt).toContain("Remotion 后期叠加");
    expect(body.input.negative_prompt).toContain("伪文字");
    expect(body.input.negative_prompt).not.toContain("包装文字");
    expect(body.input.negative_prompt).toContain("虚构产品");
    expect(body.parameters).toMatchObject({
      resolution: "720P",
      duration: 5,
      prompt_extend: false,
      watermark: false
    });
    expect(body.parameters).not.toHaveProperty("ratio");
    expect(body.parameters.seed).toEqual(expect.any(Number));
  });

  it("keeps generated shot duration within the current 3 to 8 second workflow", () => {
    expect(buildWanRequestBody({ ...request, durationSec: 2 }, "wan2.7-i2v").parameters.duration).toBe(3);
    expect(buildWanRequestBody({ ...request, durationSec: 12 }, "wan2.7-i2v").parameters.duration).toBe(8);
  });

  it("rejects collage-style multi-reference payloads", () => {
    expect(() => buildWanRequestBody({
      ...request,
      referenceImages: [
        ...request.referenceImages,
        { url: "data:image/png;base64,cHJvZHVjdA==", role: "product" as const }
      ]
    }, "wan2.7-i2v")).toThrow("exactly one first-frame image");
  });
});
