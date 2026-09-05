import React from "react";
const nodes = [
  { name: "DeepSeek", detail: "策略、分镜、提示词 · 已完成", tone: "blue" },
  { name: "Qwen-Image", detail: "广告关键帧 · 可生成", tone: "violet" },
  { name: "Wan 2.7", detail: "多参考广告视频", tone: "yellow" },
  { name: "Remotion", detail: "完整成片 · 待合成", tone: "green" }
] as const;

export function ModelRouteStrip() {
  return (
    <section className="model-route-v3" aria-label="模型路由流程">
      <span className="model-route-v3__label">模型路由流程</span>
      <div className="model-route-v3__scroller">
        <div className="model-route-v3__track" aria-hidden="true" />
        <div className="model-route-v3__nodes">
          {nodes.map((node) => (
            <div className={`model-route-node-v3 is-${node.tone}`} key={node.name}>
              <i aria-hidden="true" />
              <strong>{node.name}</strong>
              <small>{node.detail}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
