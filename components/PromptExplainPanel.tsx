import type { PromptSet, StoryboardShot } from "@/lib/schemas/project";

type PromptExplainPanelProps = { prompts?: PromptSet; shots?: StoryboardShot[]; briefLabel?: string; strategyLabel?: string };

export function PromptExplainPanel({ prompts, shots = [], briefLabel, strategyLabel }: PromptExplainPanelProps) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
      <div className="max-w-[65ch]"><p className="text-sm font-medium text-muted">提示词解释链路</p><h2 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-mist">从简报到镜头提示词</h2><p className="mt-3 text-sm leading-6 text-muted">这里不堆文本，而是解释每个镜头如何从商品信息、策略和镜头目标推导到图片与视频提示词。</p></div>
      {shots.length > 0 ? <div className="mt-6 space-y-4">{shots.map((shot) => <details key={shot.id} className="group rounded-xl border border-line bg-surface"><summary className="cursor-pointer list-none px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold text-mist">镜头 {shot.index} / {shot.goal}</div><div className="mt-1 text-xs text-muted">简报 → 策略 → 镜头目标 → 图片提示词 → 视频提示词</div></div><span className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted group-open:hidden">展开</span><span className="hidden rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted group-open:inline">收起</span></div></summary><div className="grid gap-3 border-t border-line p-5 lg:grid-cols-5"><ChainBlock title="简报" value={briefLabel ?? "低糖冷萃咖啡 / 一线城市上班族"} /><ChainBlock title="策略" value={strategyLabel ?? "清醒续航，低糖不负担"} /><ChainBlock title="镜头目标" value={shot.goal} /><ChainBlock title="图片提示词" value={shot.imagePromptCn} /><ChainBlock title="视频提示词" value={shot.videoPromptCn} /></div></details>)}</div> : <div className="mt-5 grid gap-4 lg:grid-cols-2"><ChainBlock title="图片提示词" value={prompts?.imagePrompt ?? ""} /><ChainBlock title="视频提示词" value={prompts?.videoPrompt ?? ""} /></div>}
    </section>
  );
}

function ChainBlock({ title, value }: { title: string; value: string }) {
  return <div className="min-w-0 rounded-xl border border-line bg-panel p-3"><div className="text-xs font-semibold text-blue">{title}</div><p className="mt-2 break-words text-xs leading-5 text-muted">{value}</p></div>;
}
