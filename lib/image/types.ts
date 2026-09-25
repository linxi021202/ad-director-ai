export type QwenImageCacheStatus = "cached" | "remote-only" | "not-requested";

export type QwenImageRequest = {
  prompt: string;
  referenceImage?: string;
  referenceImages?: string[];
  negativePrompt?: string;
  projectId?: string;
  shotId?: string;
  model?: string;
  size?: string;
  promptExtend?: boolean;
  watermark?: boolean;
  sessionId?: string;
  resumeTaskId?: string;
  onTaskProgress?: (progress: QwenTaskProgress) => Promise<void>;
  onSubmissionStart?: (diagnostic: QwenSubmissionDiagnostic) => Promise<void>;
};

export type QwenSubmissionDiagnostic = {
  requestHost: string;
  requestPath: string;
  region: string;
  workspaceIdMasked?: string;
  apiMode: "dashscope-async" | "dashscope-sync";
  payloadBytes: number;
  timeoutMs: number;
  referenceTypes: string[];
  requestStartedAt: number;
};

export type QwenNetworkFailure = {
  failurePhase: "DNS" | "CONNECT" | "TLS" | "REQUEST_WRITE" | "WAITING_RESPONSE" | "HTTP_RESPONSE" | "JSON_PARSE";
  errorName?: string;
  errorMessage?: string;
  causeCode?: string;
  causeErrno?: number;
  causeSyscall?: string;
};

export type QwenImageResult = {
  success: boolean;
  imageUrl?: string;
  assetId?: string;
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
  errorCode?: string;
  providerErrorCode?: string;
  httpStatus?: number;
  taskId?: string;
  requestStartedAt?: number;
  requestCompletedAt?: number;
  retryAfterMs?: number;
  submissionElapsedMs?: number;
  downloadElapsedMs?: number;
  submissionDiagnostic?: QwenSubmissionDiagnostic;
  networkFailure?: QwenNetworkFailure;
};

export type DownloadImageInput = {
  imageUrl: string;
  projectId: string;
  shotId: string;
  sessionId?: string;
};

export type QwenTaskProgress = {
  taskId: string;
  requestId?: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  submittedAt: number;
  lastPolledAt?: number;
  pollCount: number;
  imageUrl?: string;
};

export type DownloadImageResult = {
  success: boolean;
  assetId?: string;
  localUrl?: string;
  cacheStatus: QwenImageCacheStatus;
  error?: string;
  failureStage?: "download" | "persist";
};



