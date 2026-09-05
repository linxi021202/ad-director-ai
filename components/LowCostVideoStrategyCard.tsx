import type { AITraceStatus } from "@/components/AIModeBadge";
import type { HeroVideoStatus, HeroVideoSource } from "@/lib/heroVideo";
import type { StoryboardShot } from "@/lib/schemas/project";

type LowCostVideoStrategyCardProps = {
  status: AITraceStatus;
  compact?: boolean;
  heroShot?: StoryboardShot | null;
  videoSource?: HeroVideoSource | "none";
  heroVideoStatus?: HeroVideoStatus;
  projectDurationSec: number;
};

export function LowCostVideoStrategyCard({ status, compact = false, heroShot, videoSource = "none", heroVideoStatus = "prompt-ready", projectDurationSec }: LowCostVideoStrategyCardProps) {
  const currentHero = heroShot ? `镜头 ${heroShot.index} · ${trimLabel(heroShot.subtitle)} · ${heroShot.durationSec}秒视频` : "请先选择主镜头";
  const rows = [
    { label: "当前主镜头", value: currentHero },
    { label: "当前状态", value: heroVideoStatusLabel(heroVideoStatus) },
    { label: "辅助镜头", value: "Qwen-Image 关键帧 + Remotion 图片动效" },
    { label: "成片合成", value: `Remotion 合成 ${projectDurationSec} 秒完整广告片` }
  ];
  return (
    <section className={`rounded-2xl border border-line bg-panel ${compact ? "p-4" : "p-5"}`}>
      <p className="text-sm font-medium text-muted">视频策略</p>
      <h2 className="mt-1 text-lg font-semibold text-mist">主镜头视频策略</h2>
      <div className="mt-4 space-y-3">{rows.map((row) => <div key={row.label} className="rounded-xl border border-line bg-surface p-3"><div className="text-xs font-semibold text-blue">{row.label}</div><div className="mt-1 text-sm leading-6 text-mist">{row.value}</div></div>)}</div>
      <div className="mt-4 rounded-xl border border-blue/20 bg-blue/10 p-3 text-xs leading-5 text-mist">主视频通过百炼调用 Wan 2.7，并使用真实产品图作为参考；不可用时可手动导入或使用关键帧动效降级。</div>
      <div className="mt-4 flex flex-wrap gap-2"><Badge label={`最大视频镜头数： ${status.limits.maxRealVideoShotsPerRun}`} /><Badge label={`单镜头最长： ${status.limits.maxVideoSecondsPerShot}s`} /><Badge label="降级：关键帧动效" /><Badge label={`来源： ${videoSource}`} /></div>
    </section>
  );
}

export function heroVideoStatusLabel(status: HeroVideoStatus) {
  const labels: Record<HeroVideoStatus, string> = {
    "not-started": "未开始，请先选择主镜头",
    "prompt-ready": "提示词已就绪，可调用 Wan 2.7",
    "waiting-manual-upload": "等待生成或导入视频",
    uploading: "正在上传并校验视频",
    uploaded: "主镜头已就绪",
    "using-demo-asset": "正在使用本地演示视频",
    failed: "视频准备失败，请查看错误信息",
    "fallback-to-keyframe": "已降级为关键帧动效"
  };
  return labels[status];
}

function trimLabel(value: string) {
  return value.replace(/[。.!！]/g, "").slice(0, 8) || "核心镜头";
}

function Badge({ label }: { label: string }) {
  return <span className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium text-muted">{label}</span>;
}







