import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../components/auth/UserMenu", () => ({
  UserMenu: () => <span data-testid="user-menu">用户</span>
}));

import { CreativeStoryboardMark } from "../components/CreativeStoryboardMark";
import { ModelRouteStrip } from "../components/ModelRouteStrip";
import { PromptCard } from "../components/PromptCard";
import { WorkspaceHeader } from "../components/workspace/WorkspaceHeader";

describe("workspace presentation components", () => {
  it("keeps workspace navigation focused on protected product areas", () => {
    const html = renderToStaticMarkup(<WorkspaceHeader active="工作台" projectHref="/projects/demo" />);
    expect(html).toContain('href="/generate"');
    expect(html).toContain('href="/projects/demo"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain("工作台");
    expect(html).toContain("项目");
    expect(html).toContain("模型设置");
    expect(html).not.toContain("模板");
    expect(html).not.toContain("资产");
    expect(html).not.toContain("数据");
  });

  it("uses a four-shot creative mark instead of an audio waveform", () => {
    const html = renderToStaticMarkup(<CreativeStoryboardMark />);
    expect(html.match(/<span class=/g)).toHaveLength(4);
    expect(html.match(/is-hero/g)).toHaveLength(1);
    expect(html).not.toContain("creative-summary-v3__signal");
  });

  it("renders four evenly addressable model route nodes", () => {
    const html = renderToStaticMarkup(<ModelRouteStrip />);
    expect(html.match(/model-route-node-v3/g)).toHaveLength(4);
    for (const model of ["DeepSeek", "Qwen-Image", "HappyHorse", "Remotion"]) expect(html).toContain(model);
    expect(html).not.toContain("预估成本");
  });

  it("renders controlled collapsed and expanded prompt states", () => {
    const callback = vi.fn();
    const collapsed = renderToStaticMarkup(<PromptCard id="original" title="原始提示词" body="很长的提示词内容" copied={false} expanded={false} onCopy={callback} onToggle={callback} />);
    const expanded = renderToStaticMarkup(<PromptCard id="original" title="原始提示词" body="很长的提示词内容" copied expanded onCopy={callback} onToggle={callback} />);
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain("展开完整 Prompt");
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain("收起 Prompt");
    expect(expanded).toContain("is-expanded");
  });
});