import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { AdCompositionProps } from "./schemas";
import { ImageShot } from "./components/ImageShot";
import { HeroVideoShot } from "./components/HeroVideoShot";
import { ProductEndCard } from "./components/ProductEndCard";
import { getBackgroundMusicVolume, shouldMuteSourceAudio } from "./audioMix";

export function AdComposition(props: AdCompositionProps) {
  const { shots, fps, heroShotId, heroVideoUrl, productAssets, brandName, cta, voiceoverUrl, backgroundMusicUrl, narrationBeats } = props;
  let cursor = 0;
  const starts = new Map<string, number>();
  let timelineCursor = 0;
  shots.forEach((shot) => { starts.set(shot.id, timelineCursor); timelineCursor += shot.durationSec * fps; });
  const narrationIntervals = narrationBeats.map((beat) => ({
    start: starts.get(beat.shotId) ?? 0,
    end: (starts.get(beat.shotId) ?? 0) + Math.ceil(beat.durationSec * fps)
  }));
  const hasNarration = shouldMuteSourceAudio(voiceoverUrl, narrationBeats.length);

  return (
    <AbsoluteFill style={{ background: "#02040a" }}>
      {voiceoverUrl ? <Audio src={resolvePublicMedia(voiceoverUrl)} volume={0.95} /> : null}
      {backgroundMusicUrl ? <Audio src={resolvePublicMedia(backgroundMusicUrl)} volume={(frame) => getBackgroundMusicVolume(frame, narrationIntervals)} /> : null}
      {narrationBeats.map((beat) => <Sequence key={beat.id} from={starts.get(beat.shotId) ?? 0} durationInFrames={Math.ceil(beat.durationSec * fps)}>
        <Audio src={resolvePublicMedia(beat.audioUrl)} volume={0.95} />
      </Sequence>)}
      {shots.map((shot, index) => {
        const from = cursor;
        const duration = shot.durationSec * fps;
        cursor += duration;
        const isHero = shot.id === heroShotId;
        const productAsset = productAssets[0]?.url;
        const isClosingShot = index === shots.length - 1;
        const closingSource = isClosingShot ? productAsset || shot.keyframeUrl : shot.keyframeUrl;

        return (
          <Sequence key={shot.id} from={from} durationInFrames={duration}>
            {isHero ? (
              shot.subclips.length > 0
                ? <SubclipSequence clips={shot.subclips} shotDurationFrames={duration} fps={fps} subtitle={shot.subtitle} keywords={shot.keywords} muted={hasNarration} />
                : <HeroVideoShot src={heroVideoUrl} subtitle={shot.subtitle} keywords={shot.keywords} muted={hasNarration} />
            ) : isClosingShot ? (
              <ProductEndCard src={closingSource} brandName={brandName} cta={cta} subtitle={shot.subtitle} keywords={shot.keywords} />
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

function SubclipSequence({ clips, shotDurationFrames, fps, subtitle, keywords, muted }: {
  clips: AdCompositionProps["shots"][number]["subclips"];
  shotDurationFrames: number;
  fps: number;
  subtitle: string;
  keywords: string[];
  muted: boolean;
}) {
  let cursor = 0;
  return <AbsoluteFill>{clips.map((clip, index) => {
    const remaining = Math.max(1, shotDurationFrames - cursor);
    const durationInFrames = index === clips.length - 1 ? remaining : Math.min(remaining, Math.max(1, Math.round(clip.durationSec * fps)));
    const from = cursor;
    cursor += durationInFrames;
    return <Sequence key={clip.id} from={from} durationInFrames={durationInFrames}>
      <HeroVideoShot src={clip.url} subtitle={subtitle} keywords={keywords} muted={muted} />
    </Sequence>;
  })}</AbsoluteFill>;
}
