import { writeFile, unlink } from "node:fs/promises";
const source=`import React, { type CSSProperties } from "react";

export type WorkflowStepStatus = "idle" | "pending" | "running" | "completed" | "failed" | "fallback";
export type WorkflowStepKey = "brief" | "strategy" | "storyboard" | "keyframes" | "heroShot" | "render";
export type WorkflowStepState = Record<WorkflowStepKey, WorkflowStepStatus>;

const steps: Array<{ key: WorkflowStepKey; label: string }> = [
  { key: "brief", label: "简报" }, { key: "strategy", label: "策略" }, { key: "storyboard", label: "分镜" },
  { key: "keyframes", label: "关键帧" }, { key: "heroShot", label: "主镜头" }, { key: "render", label: "合成" }
];
export const idleWorkflowSteps: WorkflowStepState = { brief:"idle",strategy:"idle",storyboard:"idle",keyframes:"idle",heroShot:"idle",render:"idle" };

export function WorkflowFlowRail({ state, onRetry }: { state: WorkflowStepState; onRetry?: () => void }) {
  const allDone=steps.every(({key})=>state[key]==="completed"||state[key]==="fallback");
  const runningIndex=steps.findIndex(({key})=>state[key]==="running");
  const failedIndex=steps.findIndex(({key})=>state[key]==="failed");
  const furthest=steps.reduce((last,{key},index)=>state[key]==="completed"||state[key]==="fallback"||state[key]==="running"?index:last,-1);
  const progress=allDone?100:furthest<0?0:(furthest/(steps.length-1))*100;
  const style={"--workflow-progress":progress+"%"} as CSSProperties;
  return <section className={`workflow-flow-rail${allDone?" is-finished":""}${runningIndex>=0?" has-running":""}${failedIndex>=0?" has-failed":""}`} style={style} aria-label="生成进度">
    <div className="workflow-flow-rail__steps">
      {steps.map((step)=><div className={`workflow-flow-step is-${state[step.key]}`} data-step={step.key} key={step.key}>
        <span className="workflow-flow-step__node" aria-hidden="true">{state[step.key]==="completed"?"✓":state[step.key]==="failed"?"!":state[step.key]==="fallback"?"↘":""}</span>
        <strong>{step.label}</strong><small>{stepStatusLabel(state[step.key])}</small>
        {state[step.key]==="failed"&&onRetry?<button type="button" onClick={onRetry}>重试</button>:null}
      </div>)}
    </div>
    <div className="workflow-flow-rail__track" aria-hidden="true"><span><i /></span></div>
  </section>;
}
function stepStatusLabel(status:WorkflowStepStatus){if(status==="completed")return"已完成";if(status==="running")return"生成中";if(status==="failed")return"生成失败";if(status==="fallback")return"已降级";if(status==="pending")return"待执行";return"未开始";}
`;
await writeFile("components/WorkflowFlowRail.tsx",source,"utf8");await unlink(new URL(import.meta.url));
