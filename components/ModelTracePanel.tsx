import type { AITraceStatus } from "@/components/AIModeBadge";

export type ModelInvocationTrace = {
  id: string;
  title: string;
  stage: string;
  provider: string;
  model: string;
  latencyMs?: number | string;
  tokenUsage?: { prompt令牌?: number; completion令牌?: number; total令牌?: number };
  costEstimate?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
};

type ModelTracePanelProps = { status: AITraceStatus; traces?: ModelInvocationTrace[]; compact?: boolean };

export function ModelTracePanel({ status, traces = [], compact = false }: ModelTracePanelProps) {
  const realTextMode = status.mode === "real" && status.realTextEnabled;
  const deepseekTrace = traces.find((trace) => trace.id === "deepseek") ?? {
    id: "deepseek",
    title: "DeepSeek",
    stage: realTextMode ? "真实调用" : "模拟服务",
    provider: realTextMode ? "DeepSeek" : "模拟文本服务",
    model: realTextMode ? status.textModel : "coldBrewDemo",
    latencyMs: realTextMode ? "接口日志" : 0,
    fallbackUsed: false
  };
  const rows: ModelInvocationTrace[] = [
    deepseekTrace,
    { id: "qwen-image", title: "Qwen-Image", stage: "已完成，真实调用关键帧", provider: "百炼", model: "qwen-image", fallbackUsed: false },
    { id: "wan", title: "Wan 2.7 视频", stage: "多参考生成", provider: "百炼", model: status.videoModel || "wan2.7-r2v", fallbackUsed: false },
    { id: "remotion", title: "Remotion", stage: "第五阶段计划合成", provider: "计划节点", model: "remotion", fallbackUsed: false }
  ];

  return (
    <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted">调用日志</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-mist">模型调用审计</h2>
          {!compact ? <p className="mt-3 max-w-[62ch] text-sm leading-6 text-muted">当前主链路为 DeepSeek 文本、Qwen-Image 关键帧、Wan 2.7 多参考视频和 Remotion 合成；手动导入仅作为备用方式。</p> : null}
        </div>
        <span className="w-fit rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted">{realTextMode ? "真实调用" : "模拟数据"}</span>
      </div>

      {compact ? <div className="mt-5 grid gap-3 md:grid-cols-2">{rows.map((row) => <CompactTraceRow key={row.id} trace={row} />)}</div> : <TraceTable rows={rows} />}
    </section>
  );
}

function TraceTable({ rows }: { rows: ModelInvocationTrace[] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-line">
      <div className="hidden grid-cols-[150px_140px_minmax(220px,1fr)_120px_120px_150px] gap-4 bg-surface px-4 py-3 text-xs font-semibold text-muted lg:grid">
        <span>节点</span><span>状态</span><span>服务商 / 模型</span><span>延迟</span><span>令牌</span><span>降级</span>
      </div>
      <div className="divide-y divide-line">
        {rows.map((trace) => <TraceRow key={trace.id} trace={trace} />)}
      </div>
    </div>
  );
}

function TraceRow({ trace }: { trace: ModelInvocationTrace }) {
  return (
    <article className="grid gap-3 bg-panel px-4 py-4 text-sm lg:grid-cols-[150px_140px_minmax(220px,1fr)_120px_120px_150px] lg:items-center lg:gap-4">
      <div className="font-semibold text-mist">{trace.title}</div>
      <div className="font-medium text-blue">{trace.stage}</div>
      <div className="min-w-0"><div className="break-words text-mist">{trace.provider}</div><div className="mt-1 break-words text-xs text-muted">{trace.model}</div></div>
      <div className="text-mist">{String(trace.latencyMs ?? "-")}</div>
      <div className="text-mist">{formatTokenUsage(trace.tokenUsage)}</div>
      <div className="text-sm text-muted">降级：{trace.fallbackUsed ? "是" : "否"}</div>
    </article>
  );
}

function CompactTraceRow({ trace }: { trace: ModelInvocationTrace }) {
  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="break-words font-semibold text-mist">{trace.title}</h3><p className="mt-1 text-sm font-medium text-blue">{trace.stage}</p></div>
      </div>
      <div className="mt-3 space-y-2">
        <Small label="服务商" value={trace.provider} />
        <Small label="模型" value={trace.model} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Small label="延迟" value={String(trace.latencyMs ?? "-")} />
          <Small label="降级" value={trace.fallbackUsed ? "是" : "否"} />
        </div>
      </div>
    </article>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-line bg-panel px-3 py-2"><div className="text-xs text-muted">{label}</div><div className="mt-1 break-words text-xs font-semibold text-mist">{value}</div></div>;
}

function formatTokenUsage(usage: ModelInvocationTrace["tokenUsage"]) {
  if (!usage) return "-";
  return `p:${usage.prompt令牌 ?? "-"} c:${usage.completion令牌 ?? "-"} t:${usage.total令牌 ?? "-"}`;
}





