import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { VideoSubtitle } from "./VideoText";

export function Subtitle({ text, variant = "bottom" }: { text: string; variant?: "bottom" | "center" }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, 60], [0, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <VideoSubtitle text={text} variant={variant} />
    </AbsoluteFill>
  );
}
