import React from "react";
import { Composition } from "remotion";
import "./load-fonts";
import { AdComposition } from "./AdComposition";
import { FontDiagnostic } from "./FontDiagnostic";
import { DEFAULT_DURATION_IN_FRAMES, DEFAULT_FPS, adCompositionPropsSchema, getCompositionSize } from "./schemas";
import { DEFAULT_HERO_SHOT_INDEX, DEFAULT_SHOT_DURATIONS_SEC } from "../lib/video/durationConfig";

const defaultSize = getCompositionSize("9:16");
const defaultProps = adCompositionPropsSchema.parse({
  projectId: "preview",
  width: defaultSize.width,
  height: defaultSize.height,
  fps: DEFAULT_FPS,
  durationInFrames: DEFAULT_DURATION_IN_FRAMES,
  aspectRatio: "9:16",
  shots: DEFAULT_SHOT_DURATIONS_SEC.map((durationSec, zeroBasedIndex) => {
    const index = zeroBasedIndex + 1;
    return {
      id: `shot-${index}`,
      durationSec,
      keyframeUrl: "/landing-cold-brew-hero.png",
      subtitle: "清醒续航，低糖不负担。",
      title: `镜头 ${index}`,
      keywords: []
    };
  }),
  heroShotId: `shot-${DEFAULT_HERO_SHOT_INDEX + 1}`,
  heroVideoUrl: "/demo-videos/hero-shot.mp4",
  productAssets: [],
  cta: "立即开启轻负担时刻",
  brandName: "低糖冷萃咖啡"
});

export function Root() {
  return (
    <>
      <Composition
        id="AdDirectorFinal"
        component={AdComposition}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        fps={DEFAULT_FPS}
        width={defaultSize.width}
        height={defaultSize.height}
        schema={adCompositionPropsSchema}
        defaultProps={defaultProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: props.durationInFrames,
          fps: props.fps,
          width: props.width,
          height: props.height
        })}
      />
      <Composition id="FontDiagnostic" component={FontDiagnostic} durationInFrames={150} fps={30} width={1920} height={1080} />
    </>
  );
}