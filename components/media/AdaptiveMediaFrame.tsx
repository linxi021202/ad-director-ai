import React, { type CSSProperties, type ReactNode } from "react";
import { parseAspectRatio } from "../../lib/media/aspect-ratio";

export type MediaStageKind = "overview" | "main" | "keyframe" | "hero" | "product" | "auto";

export type AdaptiveMediaFrameProps = {
  aspectRatio: string;
  src?: string;
  poster?: string;
  mediaType: "image" | "video" | "placeholder";
  stage?: MediaStageKind;
  alt?: string;
  controls?: boolean;
  fit?: "contain" | "cover";
  showBlurredBackdrop?: boolean;
  status?: ReactNode;
  overlay?: ReactNode;
  className?: string;
  onError?: () => void;
};

export function AdaptiveMediaFrame({
  aspectRatio,
  src,
  poster,
  mediaType,
  stage = "auto",
  alt = "媒体预览",
  controls = false,
  fit = "contain",
  showBlurredBackdrop = true,
  status,
  overlay,
  className = "",
  onError
}: AdaptiveMediaFrameProps) {
  const parsed = parseAspectRatio(aspectRatio);
  const style = { "--media-aspect-ratio": parsed.cssValue } as CSSProperties;
  const backdropSource = mediaType === "image" ? src : poster;

  return (
    <div
      className={`adaptive-media-frame media-frame media-frame--${parsed.orientation} ${className}`.trim()}
      data-orientation={parsed.orientation}
      data-stage={stage}
      data-fit={fit}
      style={style}
    >
      <div className={`media-stage media-stage--${stage}`}>
        {showBlurredBackdrop && backdropSource ? <img src={backdropSource} alt="" aria-hidden="true" className="media-backdrop adaptive-media-frame__backdrop" /> : null}
        <div className="media-surface adaptive-media-frame__surface media-frame__surface">
          {mediaType === "image" && src ? <img src={src} alt={alt} className="media-foreground adaptive-media-frame__foreground" style={{ objectFit: fit }} onError={onError} /> : null}
          {mediaType === "video" && src ? <video src={src} poster={poster} controls={controls} playsInline aria-label={alt} className="media-foreground adaptive-media-frame__foreground" style={{ objectFit: fit }} onError={onError} /> : null}
          {mediaType === "placeholder" ? <div className="adaptive-media-frame__placeholder media-frame__placeholder">{overlay}</div> : null}
        </div>
        {mediaType !== "placeholder" && overlay ? <div className="adaptive-media-frame__overlay">{overlay}</div> : null}
        {status ? <div className="adaptive-media-frame__status media-frame__status">{status}</div> : null}
      </div>
    </div>
  );
}
