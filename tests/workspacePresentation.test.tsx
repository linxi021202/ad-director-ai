import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CreativeStoryboardMark } from "../components/CreativeStoryboardMark";
import { ModelRouteStrip } from "../components/ModelRouteStrip";
import { PromptCard } from "../components/PromptCard";
import { WorkspaceHeader } from "../components/workspace/WorkspaceHeader";

describe("workspace presentation components", () => {
  it("keeps navigation public and account-free", () => {
    const html = renderToStaticMarkup(
      <WorkspaceHeader active="工作台" projectHref="/projects/demo" />
    );
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/generate"');
    expect(html).toContain('href="/projects/demo"');
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain("user-menu");
    expect(html).not.toContain("退出登录");
  });

  it("uses a four-shot creative mark instead of an audio waveform", () => {
    const html = renderToStaticMarkup(<CreativeStoryboardMark />);
    expect(html.match(/<span class=/g)).toHaveLength(4);
    expect(html.match(/is-hero/g)).toHaveLength(1);
  });

  it("renders the fixed four-model route", () => {
    const html = renderToStaticMarkup(<ModelRouteStrip />);
    for (const model of ["DeepSeek", "Qwen-Image", "HappyHorse", "Remotion"]) {
      expect(html).toContain(model);
    }
  });

  it("renders controlled prompt expansion", () => {
    const callback = vi.fn();
    const collapsed = renderToStaticMarkup(
      <PromptCard id="original" title="原始提示词" body="提示词内容" copied={false} expanded={false} onCopy={callback} onToggle={callback} />
    );
    expect(collapsed).toContain('aria-expanded="false"');
  });
});