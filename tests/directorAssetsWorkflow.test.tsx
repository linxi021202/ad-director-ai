import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreativeDirectorFlow } from "../components/CreativeDirectorFlow";
import { ProductAssetStrip, moveProductImage } from "../components/ProductAssetStrip";
import { WorkflowFlowRail, idleWorkflowSteps, type WorkflowStepState } from "../components/WorkflowFlowRail";
import { setMainProductImage } from "../lib/productImages";
import type { ProductImage } from "../lib/schemas/project";

const assets: ProductImage[] = [
  { id:"a",name:"portrait.png",type:"image/png",size:100,localUrl:"/portrait.png",role:"main-product" },
  { id:"b",name:"landscape.jpg",type:"image/jpeg",size:100,localUrl:"/landscape.jpg",role:"reference" },
  { id:"c",name:"logo.webp",type:"image/webp",size:100,localUrl:"/logo.webp",role:"logo" }
];
const renderAssets=(images:ProductImage[])=>renderToStaticMarkup(<ProductAssetStrip projectId="demo" images={images} onChange={vi.fn()} />);

describe("CreativeDirectorFlow",()=>{
  it("is abstract and independent from media or aspect ratio",()=>{const html=renderToStaticMarkup(<CreativeDirectorFlow/>);expect(html).not.toContain("<img");expect(html).not.toContain("aspect-ratio");expect(html.match(/creative-director-node/g)).toHaveLength(4);expect(html).toContain("主镜头");});
  it("defines motion and reduced-motion fallback",()=>{const css=readFileSync("app/workspace-v3.css","utf8");expect(css).toContain("@keyframes director-particle");expect(css).toContain("@media(prefers-reduced-motion:reduce)");expect(css).toContain(".creative-director-flow__particle");});
});

describe("ProductAssetStrip",()=>{
  it("renders three concise empty slots",()=>{const html=renderAssets([]);expect(html.match(/product-asset-empty/g)).toHaveLength(3);expect(html).toContain("添加主产品图");});
  it.each([1,2,3])("renders %i uploaded assets with contain",(count)=>{const html=renderAssets(assets.slice(0,count));expect(html.match(/<article class="product-asset-card/g)).toHaveLength(count);expect(html).toContain('data-fit="contain"');expect(html).toContain(`${count} / 3`);if(count===3)expect(html).not.toContain("继续上传");});
  it("switches the unique main product",()=>{const next=setMainProductImage(assets,"b");expect(next.filter((image)=>image.role==="main-product")).toHaveLength(1);expect(next.find((image)=>image.id==="b")?.role).toBe("main-product");expect(next.find((image)=>image.id==="a")?.role).toBe("reference");});
  it("supports deterministic left and right sorting",()=>{expect(moveProductImage(assets,"b",-1).map((image)=>image.id)).toEqual(["b","a","c"]);expect(moveProductImage(assets,"b",1).map((image)=>image.id)).toEqual(["a","c","b"]);});
});

describe("WorkflowFlowRail",()=>{
  it("keeps idle nodes unchecked",()=>{const html=renderToStaticMarkup(<WorkflowFlowRail state={idleWorkflowSteps}/>);expect(html).toContain("未开始");expect(html).not.toContain("✓");});
  it.each([["strategy","running","生成中"],["keyframes","running","生成中"],["strategy","failed","生成失败"],["keyframes","fallback","已降级"]] as const)("renders %s as %s",(key,status,label)=>{const state={...idleWorkflowSteps,brief:"completed",[key]:status} as WorkflowStepState;const html=renderToStaticMarkup(<WorkflowFlowRail state={state}/>);expect(html).toContain(`data-step="${key}"`);expect(html).toContain(`is-${status}`);expect(html).toContain(label);});
  it("stops in a stable finished state",()=>{const state=Object.fromEntries(Object.keys(idleWorkflowSteps).map((key)=>[key,"completed"])) as WorkflowStepState;const html=renderToStaticMarkup(<WorkflowFlowRail state={state}/>);expect(html).toContain("is-finished");expect(html.match(/✓/g)).toHaveLength(6);});
});
