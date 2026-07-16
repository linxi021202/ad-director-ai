import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreativeDirectorFlow } from "../components/CreativeDirectorFlow";
import { WorkflowFlowRail, idleWorkflowSteps, type WorkflowStepState } from "../components/WorkflowFlowRail";

describe("final visual polish",()=>{
  it("keeps director flow abstract and enlarged",()=>{const html=renderToStaticMarkup(<CreativeDirectorFlow/>);expect(html).not.toContain("<img");expect(html).not.toContain("aspectRatio");const css=readFileSync("app/workspace-v3.css","utf8");expect(css).toContain("grid-template-columns:minmax(0,1fr) 300px");expect(css).toContain("width:300px; height:190px");expect(css).toContain("grid-template-columns:minmax(0,1fr) 340px");});
  it("places progress track below the step grid",()=>{const html=renderToStaticMarkup(<WorkflowFlowRail state={idleWorkflowSteps}/>);expect(html.indexOf("workflow-flow-rail__steps")).toBeLessThan(html.indexOf("workflow-flow-rail__track"));const css=readFileSync("app/workspace-v3.css","utf8");expect(css).toContain("bottom:8px");expect(css).toContain("padding-bottom:28px");});
  it("animates only running progress and stabilizes finished progress",()=>{const running={...idleWorkflowSteps,brief:"completed",strategy:"running"} as WorkflowStepState;const complete=Object.fromEntries(Object.keys(idleWorkflowSteps).map(key=>[key,"completed"])) as WorkflowStepState;expect(renderToStaticMarkup(<WorkflowFlowRail state={running}/>)).toContain("has-running");expect(renderToStaticMarkup(<WorkflowFlowRail state={complete}/>)).toContain("is-finished");const css=readFileSync("app/workspace-v3.css","utf8");expect(css).toContain("has-running:not(.has-failed):not(.is-finished)");});
  it("defines responsive gallery and cinematic background tokens",()=>{const css=readFileSync("app/workspace-v3.css","utf8");expect(css).toContain("repeat(4,minmax(250px,1fr))");expect(css).toContain("height:178px!important");expect(css).toContain("#050911 0%");expect(css).toContain("rgba(8,20,36,.76)");expect(css).toContain("@media(prefers-reduced-motion:reduce)");});
});
