import { VideoHeroPreview } from "@/components/VideoHeroPreview";
import type { VideoPreviewState } from "@/lib/schemas/project";

type VideoPreviewProps = {
  preview: VideoPreviewState;
  videoUrl?: string | null;
  fallbackUrl?: string;
};

export function VideoPreview({ preview, videoUrl, fallbackUrl }: VideoPreviewProps) {
  return <VideoHeroPreview preview={preview} videoUrl={videoUrl} fallbackUrl={fallbackUrl} />;
}