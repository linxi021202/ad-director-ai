import type { AdStrategy } from "@/lib/schemas/project";

type StrategyPanelProps = { strategy: AdStrategy };

export function StrategyPanel({ strategy }: StrategyPanelProps) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
      <p className="text-sm font-medium text-muted">广告策略</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-mist">{strategy.title}</h2>
      <p className="mt-3 max-w-[65ch] text-sm leading-6 text-muted">{strategy.audienceInsight}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="用户痛点" value={strategy.painPoint} /><Metric label="核心信息" value={strategy.coreMessage} /><Metric label="情绪钩子" value={strategy.emotionalHook} /><Metric label="CTA" value={strategy.cta} /></div>
      <div className="mt-4 rounded-xl border border-blue/20 bg-blue/10 p-4 text-sm leading-6 text-mist"><span className="font-semibold text-blue">Big Idea：</span>{strategy.bigIdea}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-line bg-surface p-3"><div className="text-xs text-muted">{label}</div><div className="mt-2 text-sm font-medium leading-5 text-mist">{value}</div></div>;
}