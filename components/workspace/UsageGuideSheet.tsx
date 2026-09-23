"use client";

import React from "react";
import { ViewportDrawer } from "./ViewportDrawer";

export function UsageGuideSheet({ open, introductory = false, onClose }: { open: boolean; introductory?: boolean; onClose: () => void }) {
  const steps = ["填写广告需求", "选择广告创意", "确认产品、主角和场景", "确认文字分镜", "确认关键帧", "生成视频与配音", "生成最终广告"];
  return <ViewportDrawer open={open} label="使用说明" onClose={onClose} className="usage-guide-sheet">
      <header><div><span>使用说明</span><h2>{introductory ? "用 1 分钟了解广告怎么生成" : "广告制作流程"}</h2></div><button type="button" aria-label="关闭使用说明" onClick={onClose}>×</button></header>
      <ol>{steps.map((step, index) => <li key={step}><span>{index + 1}</span><strong>{step}</strong></li>)}</ol>
      <p>不满意时可以只重新生成当前镜头，不需要整条广告重做。</p>
      <footer><button type="button" className="button-primary-v3" onClick={onClose}>{introductory ? "开始制作" : "知道了"}</button></footer>
  </ViewportDrawer>;
}
