import React from "react";
import { useVideoConfig } from "remotion";
import { VIDEO_FONT_FAMILY } from "../load-fonts";
import { getResponsiveVideoFontSize, getVideoSafeArea, type VideoTextRole } from "../videoTextLayout";

export { getResponsiveVideoFontSize, getVideoSafeArea } from "../videoTextLayout";
export type VideoTextWeight = 400 | 500 | 700;

type VideoTextProps = {
  children: React.ReactNode;
  text?: string;
  role?: VideoTextRole;
  weight?: VideoTextWeight;
  maxLines?: 1 | 2;
  align?: "left" | "center" | "right";
  style?: React.CSSProperties;
};

export function VideoText({ children, text, role = "body", weight, maxLines = 2, align = "left", style }: VideoTextProps) {
  const { width, height } = useVideoConfig();
  const safeArea = getVideoSafeArea(width, height);
  const maxWidth = Number(style?.maxWidth) || width - safeArea.horizontal * 2;
  const content = text ?? (typeof children === "string" ? children : "");
  const fontSize = getResponsiveVideoFontSize(role, width, content, maxWidth, maxLines);
  const resolvedWeight = weight ?? (role === "body" ? 400 : role === "label" ? 500 : 700);

  return (
    <div style={{ fontFamily: VIDEO_FONT_FAMILY, fontWeight: resolvedWeight, fontSize, lineHeight: role === "headline" ? 1.12 : 1.3, textAlign: align, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", maxWidth, ...style }}>
      {children}
    </div>
  );
}

export function VideoHeadline(props: Omit<VideoTextProps, "role">) {
  return <VideoText {...props} role="headline" />;
}

export function VideoSubtitle({ text, variant = "bottom" }: { text: string; variant?: "bottom" | "center" }) {
  const { width, height } = useVideoConfig();
  const safeArea = getVideoSafeArea(width, height);
  const maxWidth = Math.min(width - safeArea.horizontal * 2, width > height ? 920 : width - safeArea.horizontal * 2);

  return (
    <div style={{ position: "absolute", left: safeArea.horizontal, right: safeArea.horizontal, bottom: variant === "bottom" ? safeArea.bottom : undefined, top: variant === "center" ? "50%" : undefined, transform: variant === "center" ? "translateY(-50%)" : undefined, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <VideoText text={text} role="subtitle" maxLines={2} align="center" style={{ maxWidth, background: "rgba(3, 7, 18, 0.66)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 22, padding: height > width ? "18px 28px" : "14px 26px", color: "white", boxShadow: "0 18px 60px rgba(0,0,0,0.35)" }}>
        {text}
      </VideoText>
    </div>
  );
}
