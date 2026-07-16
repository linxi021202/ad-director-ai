import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreativeStoryboardFlow } from "../components/CreativeStoryboardFlow";
import { ProductMediaSection } from "../components/ProductMediaSection";
import type { ProductImage } from "../lib/schemas/project";

const productImage: ProductImage = {
  id: "product-1",
  name: "cold-brew.png",
  type: "image/png",
  size: 1024,
  localUrl: "/generated/product.png",
  role: "main-product"
};

describe("creative workspace refactor", () => {
  it("keeps the empty product stage concise", () => {
    const html = renderToStaticMarkup(<ProductMediaSection projectId="demo" images={[]} onChange={vi.fn()} />);
    expect(html).toContain("上传产品图");
    expect(html).toContain("product-media-empty");
    expect(html).not.toContain("用于产品一致性和结尾 CTA");
    expect(html).not.toContain("PNG / JPG / WebP");
  });

  it("renders uploaded product media with contain and compact actions", () => {
    const html = renderToStaticMarkup(<ProductMediaSection projectId="demo" images={[productImage]} onChange={vi.fn()} />);
    expect(html).toContain('/generated/product.png');
    expect(html).toContain('data-fit="contain"');
    expect(html).toContain("查看大图");
    expect(html).toContain("更换");
    expect(html).toContain("删除");
    expect(html).not.toContain("未上传");
  });

  it("renders four storyboard frames and a curved flow path", () => {
    const html = renderToStaticMarkup(<CreativeStoryboardFlow items={[
      { id: "shot-1", label: "镜头 1" },
      { id: "shot-2", label: "镜头 2" },
      { id: "shot-3", label: "镜头 3", hero: true },
      { id: "shot-4", label: "镜头 4" }
    ]} />);
    expect(html.match(/creative-flow-frame/g)).toHaveLength(4);
    expect(html).toContain("creative-storyboard-flow__path");
    expect(html).toContain("主镜头");
    expect(html).not.toContain("creative-summary-v3__signal");
  });

  it("defines fixed media, compact route, aligned shells and reduced motion", () => {
    const css = readFileSync("app/workspace-v3.css", "utf8");
    expect(css).toContain(".product-media-stage { position:relative; display:grid; width:100%; height:160px");
    expect(css).toContain(".model-route-v3 { height:84px");
    expect(css).toContain(".workbench-layout { min-height:calc(100vh - 88px - 72px); align-items:stretch;");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(css).toContain(".creative-storyboard-flow__dot");
  });
});
