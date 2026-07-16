import type { VideoPreviewState } from "@/lib/schemas/project";

type VideoHeroPreviewProps = { preview: VideoPreviewState; videoUrl?: string | null; fallbackUrl?: string; prominent?: boolean };

export function VideoHeroPreview({ preview, videoUrl, fallbackUrl, prominent = false }: VideoHeroPreviewProps) {
  return (
    <section className={`video-cinema-card ${prominent ? "video-cinema-card-prominent" : ""}`}>
      <div className="video-cinema-head">
        <div>
          <p>最终合成</p>
          <h2>9:16 预览</h2>
        </div>
        <span>{preview.durationSec}s</span>
      </div>
      <div className="video-cinema-frame video-cinema-frame--abstract">
        <div className="video-cinema-time"><span>00:18</span><span>9:16</span></div>
        <div className="video-cinema-caption">
          <p>{videoUrl ? "模拟视频已就绪" : "计划合成"}</p>
          <h3>{preview.title}</h3>
        </div>
      </div>
      <div className="video-cinema-foot">
        <span>降级就绪</span>
        <span>{fallbackUrl ? "图片动效" : "HappyHorse"}</span>
      </div>
    </section>
  );
}


