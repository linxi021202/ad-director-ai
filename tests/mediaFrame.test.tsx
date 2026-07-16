import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdaptiveMediaFrame } from "../components/media/AdaptiveMediaFrame";

describe("AdaptiveMediaFrame", () => {
  it.each([
    ["9:16", "portrait"],
    ["1:1", "square"],
    ["16:9", "landscape"]
  ] as const)("keeps %s media contained in a stable orientation frame", (aspectRatio, orientation) => {
    const html = renderToStaticMarkup(
      <AdaptiveMediaFrame
        aspectRatio={aspectRatio}
        src="/generated.png"
        mediaType="image"
        stage="overview"
        alt="测试关键帧"
      />
    );

    expect(html).toContain(`data-orientation="${orientation}"`);
    expect(html).toContain("object-fit:contain");
    expect(html).toContain("media-frame__surface");
    expect(html).toContain('data-stage="overview"');
    expect(html).toContain("media-stage--overview");
  });

  it("renders video controls without changing the media frame", () => {
    const html = renderToStaticMarkup(
      <AdaptiveMediaFrame
        aspectRatio="16:9"
        src="/hero.mp4"
        mediaType="video"
        alt="主镜头视频"
        controls
      />
    );

    expect(html).toContain("<video");
    expect(html).toContain("controls");
    expect(html).toContain('data-orientation="landscape"');
  });
});
