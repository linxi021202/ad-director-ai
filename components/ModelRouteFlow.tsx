import type { AITraceStatus } from "@/components/AIModeBadge";
import type { ModelRoute } from "@/lib/schemas/project";

type ModelRouteFlowProps = { routes: ModelRoute[]; aiStatus?: AITraceStatus };

const stages = [
  { task: "文本", model: "DeepSeek", note: "已完成，真实调用" },
  { task: "关键帧", model: "Qwen-Image", note: "已完成，真实调用关键帧" },
  { task: "广告视频", model: "Wan 2.7 R2V", note: "真实产品多参考生成" },
  { task: "合成", model: "Remotion", note: "第五阶段计划合成" }
];

export function ModelRouteFlow({ routes, aiStatus }: ModelRouteFlowProps) {
  const realTextMode = aiStatus?.mode === "real" && aiStatus.realTextEnabled;
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
      <div className="max-w-[65ch]">
        <p className="text-sm font-medium text-muted">模型路由</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-mist">模型主链路</h2>
        <p className="mt-3 text-sm leading-6 text-muted">DeepSeek 负责文本与提示词，Qwen-Image 负责关键帧，Wan 2.7 负责多参考视频生成，Remotion 负责确定性成片合成。</p>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        {stages.map((stage, index) => (
          <div key={stage.task} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3 text-xs text-muted"><span>{index + 1}</span><span>{index === 0 && realTextMode ? "真实调用" : index === 0 ? "mock" : "planned"}</span></div>
            <h3 className="mt-4 text-base font-semibold text-mist">{stage.model}</h3>
            <p className="mt-2 text-sm leading-5 text-muted">{stage.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-line">
        <div className="hidden grid-cols-[120px_minmax(160px,1fr)_minmax(260px,1.5fr)_minmax(150px,1fr)] gap-4 bg-surface px-4 py-3 text-xs font-semibold text-muted lg:grid">
          <span>任务</span><span>模型</span><span>选择理由</span><span>降级</span>
        </div>
        <div className="divide-y divide-line">
          {routes.map((route, index) => <RouteRow key={`${route.taskType}-${route.primaryModel}-${index}`} route={route} />)}
        </div>
      </div>
    </section>
  );
}

function RouteRow({ route }: { route: ModelRoute }) {
  return (
    <article className="grid gap-3 bg-panel px-4 py-4 text-sm lg:grid-cols-[120px_minmax(160px,1fr)_minmax(260px,1.5fr)_minmax(150px,1fr)] lg:items-center lg:gap-4">
      <div className="font-semibold text-blue">{route.taskType}</div>
      <div className="min-w-0 break-words font-semibold text-mist">{route.primaryModel}</div>
      <p className="min-w-0 break-words leading-6 text-muted">{route.reason}</p>
      <div className="min-w-0 break-words text-sm leading-5 text-muted">{route.fallbackMode}</div>
    </article>
  );
}

