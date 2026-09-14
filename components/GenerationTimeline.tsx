import type { GenerationStep } from "@/lib/schemas/project";

type GenerationTimelineProps = { steps?: GenerationStep[]; generated?: boolean };
const statusLabel: Record<GenerationStep["status"], string> = { done: "完成", running: "生成中", pending: "等待", fallback: "降级" };
const defaultStages = ["策略", "分镜", "提示词", "图片", "视频", "合成"];

export function GenerationTimeline({ steps, generated = true }: GenerationTimelineProps) {
  const displaySteps = steps ?? defaultStages.map((stage) => ({ name: stage, status: generated ? "done" as const : "pending" as const, description: generated ? stageDescription(stage) : "等待点击生成 Demo 后展示结果。" }));
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <p className="text-sm font-medium text-muted">生成进度</p>
      <h2 className="mt-1 text-xl font-semibold text-mist">制作时间线</h2>
      <div className="mt-5 space-y-4">{displaySteps.map((step, index) => <div key={step.name} className="flex gap-3"><div className="flex flex-col items-center"><div className={step.status === "pending" ? "mt-1 h-3 w-3 shrink-0 rounded-full border border-line bg-panel" : "mt-1 h-3 w-3 shrink-0 rounded-full bg-mint"} />{index < displaySteps.length - 1 ? <div className="mt-2 h-full min-h-8 w-px bg-line" /> : null}</div><div className="min-w-0 pb-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-mist">{step.name}</span><span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{statusLabel[step.status]}</span></div><p className="mt-1 break-words text-sm leading-6 text-muted">{step.description}</p></div></div>)}</div>
    </section>
  );
}

function stageDescription(stage: string) {
  const map: Record<string, string> = { strategy: "DeepSeek 生成广告策略。", storyboard: "DeepSeek 生成动态分镜。", prompt: "DeepSeek 生成图片与视频提示词。", image: "Qwen-Image 负责关键帧。", video: "Wan 2.7 使用关键帧和真实产品参考图生成广告视频。", render: "Remotion 负责成片合成和图片动效降级。" };
  return map[stage] ?? "已完成。";
}
