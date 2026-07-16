import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { SafeMedia } from "./SafeMedia";
import { Subtitle } from "./Subtitle";
import { KeywordOverlay } from "./KeywordOverlay";
import { VideoText, getVideoSafeArea } from "./VideoText";

export function ImageShot({ src, subtitle, title, mode, keywords }: { src: string; subtitle: string; title: string; mode: "scale" | "pan"; keywords?: string[] }) {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const safeArea = getVideoSafeArea(width, height);
  const scale = mode === "scale" ? interpolate(frame, [0, durationInFrames], [1, 1.06]) : 1.04;
  const x = mode === "pan" ? interpolate(frame, [0, durationInFrames], [-28, 28]) : 0;

  return (
    <AbsoluteFill style={{ background: "#05070c", overflow: "hidden" }}>
      <AbsoluteFill style={{ filter: "blur(36px)", opacity: 0.44, transform: "scale(1.08)" }}>
        <SafeMedia src={src} type="image" fit="cover" />
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `translateX(${x}px) scale(${scale})`, transition: "transform 0.1s linear" }}>
        <SafeMedia src={src} type="image" fit="contain" />
      </AbsoluteFill>
      <VideoText
        text={title}
        role="label"
        weight={500}
        maxLines={2}
        style={{
          position: "absolute",
          top: height > width ? 64 : 42,
          left: safeArea.horizontal,
          color: "rgba(255,255,255,0.82)",
          maxWidth: width * 0.5,
          letterSpacing: 1.2
        }}
      >
        {title}
      </VideoText>
      <KeywordOverlay keywords={keywords} />
      <Subtitle text={subtitle} />
    </AbsoluteFill>
  );
}
