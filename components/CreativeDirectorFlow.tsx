import React from "react";

export function CreativeDirectorFlow() {
  const nodes = [
    { key: "01", className: "is-one" },
    { key: "02", className: "is-two" },
    { key: "HERO", className: "is-hero" },
    { key: "04", className: "is-four" }
  ];
  return (
    <div className="creative-director-flow" aria-label="广告导演流程">
      <div className="creative-director-flow__glow" aria-hidden="true" />
      <svg viewBox="0 0 280 174" aria-hidden="true">
        <defs>
          <linearGradient id="director-flow-gradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ff6572" /><stop offset=".46" stopColor="#49d9ff" /><stop offset=".72" stopColor="#f8fafc" /><stop offset="1" stopColor="#53e49d" /></linearGradient>
          <linearGradient id="director-flow-highlight" x1="0" y1="0" x2="1" y2="0"><stop stopColor="transparent" /><stop offset=".5" stopColor="#fff" /><stop offset="1" stopColor="transparent" /></linearGradient>
        </defs>
        <path className="creative-director-flow__base" d="M20 128 C64 34 101 132 145 78 S219 36 260 102" />
        <path className="creative-director-flow__beam" d="M20 128 C64 34 101 132 145 78 S219 36 260 102" />
      </svg>
      <i className="creative-director-flow__particle is-first" aria-hidden="true" />
      <i className="creative-director-flow__particle is-second" aria-hidden="true" />
      {nodes.map((node) => <span key={node.key} className={`creative-director-node ${node.className}`}><b>{node.key}</b>{node.className === "is-hero" ? <em aria-hidden="true">▶</em> : null}</span>)}
      <span className="creative-director-finish" aria-label="成片完成">✓</span>
    </div>
  );
}
