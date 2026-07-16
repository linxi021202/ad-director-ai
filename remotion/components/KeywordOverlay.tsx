import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { VideoText } from "./VideoText";

type KeywordOverlayProps = { keywords?: string[] };

export function KeywordOverlay({ keywords = [] }: KeywordOverlayProps) {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  if (keywords.length === 0) return null;

  const firstWindow = [durationInFrames * 0.2, durationInFrames * 0.42];
  const secondWindow = [durationInFrames * 0.58, durationInFrames * 0.8];
  const showSecond = keywords.length > 1 && frame >= secondWindow[0];
  const window = showSecond ? secondWindow : firstWindow;
  const keyword = showSecond ? keywords[1] : keywords[0];
  const opacity = interpolate(frame, [window[0], window[0] + 8, window[1] - 8, window[1]], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const y = interpolate(frame, [window[0], window[0] + 12], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const vertical = height > width;

  return (
    <VideoText
      text={keyword}
      role="label"
      weight={700}
      maxLines={2}
      align="center"
      style={{
        position: "absolute",
        top: vertical ? 150 : 82,
        right: vertical ? 64 : 92,
        maxWidth: vertical ? width * 0.58 : width * 0.42,
        opacity,
        transform: `translateY(${y}px)`,
        border: "1px solid rgba(255,255,255,0.25)",
        borderRadius: 999,
        background: "rgba(2,8,18,0.62)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.32)",
        padding: vertical ? "14px 24px" : "10px 20px",
        color: "#f8fafc",
        letterSpacing: 1,
        backdropFilter: "blur(14px)"
      }}
    >
      {keyword}
    </VideoText>
  );
}
