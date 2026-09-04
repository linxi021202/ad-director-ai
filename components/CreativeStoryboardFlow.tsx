import React from "react";

export type CreativeStoryboardItem = { id: string; label: string; imageUrl?: string; hero?: boolean };

export function CreativeStoryboardFlow({ items }: { items: CreativeStoryboardItem[] }) {
  const frames = items;
  return (
    <div className="creative-storyboard-flow" aria-label="四镜头创意流">
      <svg className="creative-storyboard-flow__path" viewBox="0 0 260 160" aria-hidden="true">
        <defs><linearGradient id="story-flow-gradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ff6673" /><stop offset=".48" stopColor="#49d9ff" /><stop offset=".72" stopColor="#f4f7fb" /><stop offset="1" stopColor="#53e49d" /></linearGradient></defs>
        <path d="M22 112 C60 30 98 132 132 73 S202 30 238 93" />
      </svg>
      <i className="creative-storyboard-flow__dot is-one" aria-hidden="true" />
      <i className="creative-storyboard-flow__dot is-two" aria-hidden="true" />
      {frames.map((frame, index) => (
        <article key={frame.id} className={`creative-flow-frame is-${index + 1}${frame.hero ? " is-hero" : ""}`}>
          {frame.imageUrl ? <img src={frame.imageUrl} alt="" /> : <span />}
          <small>{frame.hero ? "主镜头" : frame.label}</small>
          {frame.hero ? <b aria-hidden="true">▶</b> : null}
        </article>
      ))}
    </div>
  );
}
