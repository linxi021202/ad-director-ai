import React from "react";
import { Img, Video, staticFile } from "remotion";

type SafeMediaProps = {
  src: string;
  type: "image" | "video";
  fit?: "contain" | "cover";
  muted?: boolean;
};

export function resolveMediaSrc(src: string) {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("file://")) return src;
  return staticFile(src.replace(/^\//, ""));
}

export function SafeMedia({ src, type, fit = "contain", muted = true }: SafeMediaProps) {
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: fit,
    display: "block"
  };

  if (type === "video") return <Video src={resolveMediaSrc(src)} style={style} muted={muted} />;
  return <Img src={resolveMediaSrc(src)} style={style} />;
}
