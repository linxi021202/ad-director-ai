import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { SafeMedia } from "./SafeMedia";
import { KeywordOverlay } from "./KeywordOverlay";
import { VideoHeadline, VideoText, getVideoSafeArea } from "./VideoText";

export function ProductEndCard({ src, brandName, cta, subtitle, keywords }: { src: string; brandName: string; cta: string; subtitle: string; keywords?: string[] }) {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.035]);
  const isVertical = height > width;
  const safeArea = getVideoSafeArea(width, height);

  return (
    <AbsoluteFill style={{ background: "#05070c", overflow: "hidden" }}>
      <AbsoluteFill style={{ filter: "blur(44px)", opacity: 0.32, transform: "scale(1.12)" }}>
        <SafeMedia src={src} type="image" fit="cover" />
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <SafeMedia src={src} type="image" fit="contain" />
      </AbsoluteFill>
      <KeywordOverlay keywords={keywords} />

      <div style={{ position: "absolute", left: safeArea.horizontal, right: safeArea.horizontal, bottom: safeArea.bottom, opacity, display: "grid", gap: 22, justifyItems: isVertical ? "start" : "center", color: "white" }}>
        <VideoHeadline text={brandName} weight={700} maxLines={2} align={isVertical ? "left" : "center"} style={{ textShadow: "0 12px 42px rgba(0,0,0,0.5)" }}>
          {brandName}
        </VideoHeadline>
        <VideoText text={subtitle} role="body" weight={400} maxLines={2} align={isVertical ? "left" : "center"} style={{ maxWidth: 840, color: "rgba(255,255,255,0.82)" }}>
          {subtitle}
        </VideoText>
        <VideoText text={cta} role="cta" weight={700} maxLines={2} align="center" style={{ borderRadius: 999, background: "rgba(255,255,255,0.92)", color: "#030712", padding: "18px 32px" }}>
          {cta}
        </VideoText>
      </div>
    </AbsoluteFill>
  );
}
