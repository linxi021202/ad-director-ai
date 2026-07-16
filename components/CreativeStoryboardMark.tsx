import React from "react";
export function CreativeStoryboardMark() {
  return (
    <div className="creative-storyboard-mark" aria-hidden="true">
      <div className="creative-storyboard-mark__track" />
      {[1, 2, 3, 4].map((shot) => (
        <span key={shot} className={shot === 3 ? "is-hero" : ""}>
          <i>{shot === 3 ? "▶" : ""}</i>
        </span>
      ))}
      <em>✦</em>
    </div>
  );
}
