import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";

export type KeyframeGenerationStatus = "idle" | "loading" | "ready" | "failed";

export type KeyframeResult = {
  shotId: string;
  imageUrl?: string;
  localUrl?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  requestId?: string;
  size?: string;
  cacheStatus?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  status: KeyframeGenerationStatus;
};

type KeyframePreviewProps = {
  result?: KeyframeResult;
  aspectRatio?: string;
  placeholderUrl?: string;
};

export function KeyframePreview({ result, aspectRatio = "9:16", placeholderUrl = "/landing-cold-brew-hero.png" }: KeyframePreviewProps) {
  const status = result?.status ?? "idle";
  const imageUrl = result?.localUrl || result?.imageUrl;
  const source = imageUrl || placeholderUrl;

  return (
    <div className={"keyframe-preview-v3 is-" + status}>
      <AdaptiveMediaFrame
        aspectRatio={aspectRatio}
        stage="keyframe"
        src={source}
        mediaType="image"
        fit="contain"
        alt={status === "idle" ? "关键帧视觉参考" : "镜头关键帧"}
        className="keyframe-preview-v3__frame"
        overlay={status === "loading" ? <div className="keyframe-preview-v3__loading"><i /><span>关键帧生成中</span></div> : status === "idle" ? <div className="keyframe-preview-v3__empty"><strong>关键帧待生成</strong><span>{aspectRatio} · 将使用当前提示词</span></div> : null}
        status={status === "failed" ? <span className="keyframe-preview-v3__fallback"><i />本地降级图</span> : null}
      />
    </div>
  );
}