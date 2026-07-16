export type QwenImageCacheStatus = "cached" | "remote-only" | "not-requested";

export type QwenImageRequest = {
  prompt: string;
  referenceImage?: string;
  negativePrompt?: string;
  projectId?: string;
  shotId?: string;
  model?: string;
  size?: string;
  promptExtend?: boolean;
  watermark?: boolean;
  sessionId?: string;
};

export type QwenImageResult = {
  success: boolean;
  imageUrl?: string;
  localUrl?: string;
  requestId?: string;
  provider: "dashscope";
  model: string;
  latencyMs: number;
  size: string;
  cacheStatus?: QwenImageCacheStatus;
  costEstimate?: string;
  referenceUsed?: boolean;
  error?: string;
};

export type DownloadImageInput = {
  imageUrl: string;
  projectId: string;
  shotId: string;
};

export type DownloadImageResult = {
  success: boolean;
  localUrl?: string;
  cacheStatus: QwenImageCacheStatus;
  error?: string;
};



