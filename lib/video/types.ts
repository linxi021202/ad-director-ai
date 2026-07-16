export type HappyHorseVideoRequest = {
  referenceImages: Array<{
    url: string;
    role: "product" | "scene";
  }>;
  prompt: string;
  projectId: string;
  shotId: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  durationSec: number;
  model?: string;
  sessionId?: string;
};

export type HappyHorseVideoResult = {
  success: boolean;
  provider: "dashscope";
  model: string;
  taskId?: string;
  requestId?: string;
  remoteVideoUrl?: string;
  latencyMs: number;
  error?: string;
};

export type DownloadVideoResult = {
  success: boolean;
  buffer?: Buffer;
  sizeBytes?: number;
  mimeType?: string;
  error?: string;
};
