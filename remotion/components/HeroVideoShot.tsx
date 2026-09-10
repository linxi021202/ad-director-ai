import React from "react";
import { AbsoluteFill } from "remotion";
import { SafeMedia } from "./SafeMedia";
import { Subtitle } from "./Subtitle";
import { KeywordOverlay } from "./KeywordOverlay";

export function HeroVideoShot({ src, subtitle, keywords, muted = false }: { src: string; subtitle: string; keywords?: string[]; muted?: boolean }) {
  return (
    <AbsoluteFill style={{ background: "#030712", overflow: "hidden" }}>
      <AbsoluteFill style={{ filter: "blur(44px)", opacity: 0.38, transform: "scale(1.1)" }}>
        <SafeMedia src={src} type="video" fit="cover" muted />
      </AbsoluteFill>
      <AbsoluteFill>
        <SafeMedia src={src} type="video" fit="contain" muted={muted} />
      </AbsoluteFill>
      <KeywordOverlay keywords={keywords} />
      {subtitle ? <Subtitle text={subtitle} /> : null}
    </AbsoluteFill>
  );
}
