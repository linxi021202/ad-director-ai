import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { AdCompositionProps } from "./schemas";
import { ImageShot } from "./components/ImageShot";
import { HeroVideoShot } from "./components/HeroVideoShot";
import { ProductEndCard } from "./components/ProductEndCard";

export function AdComposition(props: AdCompositionProps) {
  const { shots, fps, heroShotId, heroVideoUrl, productAssets, brandName, cta, voiceoverUrl } = props;
  let cursor = 0;

  return (
    <AbsoluteFill style={{ background: "#02040a" }}>
      {voiceoverUrl ? <Audio src={resolvePublicMedia(voiceoverUrl)} volume={0.95} /> : null}
      {shots.map((shot, index) => {
        const from = cursor;
        const duration = shot.durationSec * fps;
        cursor += duration;
        const isHero = shot.id === heroShotId;
        const productAsset = productAssets[0]?.url;
        const shotFourSource = index === 3 ? productAsset || shot.keyframeUrl : shot.keyframeUrl;

        return (
          <Sequence key={shot.id} from={from} durationInFrames={duration}>
            {isHero ? (
              <HeroVideoShot src={heroVideoUrl} subtitle={shot.subtitle} keywords={shot.keywords} muted={Boolean(voiceoverUrl)} />
            ) : index === 3 ? (
              <ProductEndCard src={shotFourSource} brandName={brandName} cta={cta} subtitle={shot.subtitle} keywords={shot.keywords} />
            ) : (
              <ImageShot src={shot.keyframeUrl} title={shot.title} subtitle={shot.subtitle} keywords={shot.keywords} mode={index === 1 ? "pan" : "scale"} />
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function resolvePublicMedia(src: string) {
  return src.startsWith("/") ? staticFile(src.slice(1)) : src;
}