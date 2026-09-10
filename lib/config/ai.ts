import { z } from "zod";

const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com";

const booleanEnvSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalSecretSchema = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  });

const optionalUrlEnvSchema = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed && trimmed.length > 0 ? trimmed : fallback;
    })
    .pipe(z.string().url());

const positiveIntEnvSchema = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (!value || value.trim().length === 0) {
        return fallback;
      }

      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Expected a positive integer, received "${value}".`);
      }

      return parsed;
    });

const envSchema = z.object({
  AI_MODE: z.enum(["mock", "real"]).default("mock"),
  ENABLE_REAL_TEXT: booleanEnvSchema,
  ENABLE_REAL_IMAGE: booleanEnvSchema,
  ENABLE_REAL_VIDEO: booleanEnvSchema,
  ALLOW_PLATFORM_KEYS: booleanEnvSchema,

  DEEPSEEK_API_KEY: optionalSecretSchema,
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().min(1).default("deepseek-v4-pro"),
  DEEPSEEK_TIMEOUT_MS: positiveIntEnvSchema(90_000),
  DEEPSEEK_MAX_RETRIES: positiveIntEnvSchema(1),

  DASHSCOPE_API_KEY: optionalSecretSchema,
  DASHSCOPE_BASE_URL: optionalUrlEnvSchema(DEFAULT_DASHSCOPE_BASE_URL),
  QWEN_IMAGE_MODEL: z.string().min(1).default("qwen-image"),
  VISUAL_INSPECTOR_MODEL: z.string().min(1).default("qwen3.7-plus"),
  QWEN_IMAGE_SIZE: z.string().min(1).default("1152*2048"),
  QWEN_IMAGE_PROMPT_EXTEND: booleanEnvSchema,
  QWEN_IMAGE_WATERMARK: booleanEnvSchema,

  COSYVOICE_MODEL: z.string().min(1).default("cosyvoice-v3-flash"),
  COSYVOICE_VOICE: z.string().min(1).default("longanyang"),
  COSYVOICE_BASE_URL: optionalUrlEnvSchema(DEFAULT_DASHSCOPE_BASE_URL),
  VIDEO_PROVIDER: z.string().optional().transform(() => "wan" as const),
  WAN_VIDEO_MODEL: z.string().min(1).default("wan2.7-i2v"),
  WAN_VIDEO_RESOLUTION: z.enum(["720P", "1080P"]).default("720P"),
  WAN_BASE_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .pipe(z.string().url().optional()),
  HAPPYHORSE_API_KEY: optionalSecretSchema,
  HAPPYHORSE_BASE_URL: z.string().optional().transform((value) => value?.trim() || DEFAULT_DASHSCOPE_BASE_URL),
  HAPPYHORSE_MODEL: z.string().min(1).default("happyhorse-1.0-r2v"),
  HAPPYHORSE_VIDEO_ASSET_PATH: z.string().min(1).default("/demo-videos/hero-shot.mp4"),

  MAX_TEXT_CALLS_PER_RUN: positiveIntEnvSchema(3),
  MAX_IMAGES_PER_RUN: positiveIntEnvSchema(12),
  MAX_REAL_VIDEO_SHOTS_PER_RUN: positiveIntEnvSchema(1),
  MAX_VIDEO_SECONDS_PER_SHOT: positiveIntEnvSchema(7)
});

type RawAIEnv = z.infer<typeof envSchema>;

export type AIConfig = {
  mode: RawAIEnv["AI_MODE"];
  realTextEnabled: boolean;
  realImageEnabled: boolean;
  realVideoEnabled: boolean;
  platformKeysAllowed: boolean;
  deepseek: { apiKey?: string; baseUrl: string; model: string; configured: boolean };
  qwenImage: { apiKey?: string; baseUrl: string; imageModel: string; inspectorModel: string; size: string; promptExtend: boolean; watermark: boolean; configured: boolean };
  video: {
    provider: RawAIEnv["VIDEO_PROVIDER"];
    model: string;
    baseUrl: string;
    resolution: "720P" | "1080P";
    happyHorseApiKey?: string;
    happyHorseBaseUrl: string;
    happyHorseModel: string;
    assetPath: string;
    configured: boolean;
  };
  tts: { baseUrl: string; model: string; voice: string; configured: boolean };
  limits: { maxTextCallsPerRun: number; maxImagesPerRun: number; maxRealVideoShotsPerRun: number; maxVideoSecondsPerShot: number };
};
export type PublicAIStatus = {
  configured: boolean;
  mode: AIConfig["mode"];
  realTextEnabled: boolean;
  realImageEnabled: boolean;
  realVideoEnabled: boolean;
  platformKeysAllowed: boolean;
  deepseekConfigured: boolean;
  textModel: string;
  imageConfigured: boolean;
  imageProvider: "dashscope";
  imageModel: string;
  imageSize: string;
  imagePromptExtend: boolean;
  imageWatermark: boolean;
  videoProvider: AIConfig["video"]["provider"];
  videoModel: string;
  videoConfigured: boolean;
  videoAssetPath: string;
  limits: AIConfig["limits"];
};

function parseEnv(): RawAIEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(`Invalid AI environment config: ${parsed.error.message}`);
  }

  return parsed.data;
}

function assertRequiredSecrets(env: RawAIEnv) {
  if (env.AI_MODE === "real" && env.ENABLE_REAL_TEXT && !env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is required when AI_MODE=real and ENABLE_REAL_TEXT=true.");
  }

  if (env.ENABLE_REAL_IMAGE && !env.DASHSCOPE_API_KEY) {
    throw new Error("DASHSCOPE_API_KEY is required when ENABLE_REAL_IMAGE=true.");
  }
}

function buildConfig(env: RawAIEnv): AIConfig {
  const allowPlatformKeys = process.env.NODE_ENV !== "production" && env.ALLOW_PLATFORM_KEYS;
  const deepseekApiKey = allowPlatformKeys ? env.DEEPSEEK_API_KEY : undefined;
  const dashscopeApiKey = allowPlatformKeys ? env.DASHSCOPE_API_KEY : undefined;

  return {
    mode: env.AI_MODE,
    realTextEnabled: env.ENABLE_REAL_TEXT,
    realImageEnabled: env.ENABLE_REAL_IMAGE,
    realVideoEnabled: env.ENABLE_REAL_VIDEO,
    platformKeysAllowed: allowPlatformKeys,
    deepseek: { apiKey: deepseekApiKey, baseUrl: env.DEEPSEEK_BASE_URL, model: env.DEEPSEEK_MODEL, configured: Boolean(deepseekApiKey) },
    qwenImage: { apiKey: dashscopeApiKey, baseUrl: env.DASHSCOPE_BASE_URL, imageModel: env.QWEN_IMAGE_MODEL, inspectorModel: env.VISUAL_INSPECTOR_MODEL, size: env.QWEN_IMAGE_SIZE, promptExtend: env.QWEN_IMAGE_PROMPT_EXTEND, watermark: env.QWEN_IMAGE_WATERMARK, configured: Boolean(dashscopeApiKey) },
    video: {
      provider: env.VIDEO_PROVIDER,
      model: env.WAN_VIDEO_MODEL,
      baseUrl: env.WAN_BASE_URL || env.DASHSCOPE_BASE_URL,
      resolution: env.WAN_VIDEO_RESOLUTION,
      happyHorseApiKey: undefined,
      happyHorseBaseUrl: env.HAPPYHORSE_BASE_URL || env.DASHSCOPE_BASE_URL,
      happyHorseModel: env.HAPPYHORSE_MODEL,
      assetPath: env.HAPPYHORSE_VIDEO_ASSET_PATH,
      configured: false
    },
    tts: { baseUrl: env.COSYVOICE_BASE_URL, model: env.COSYVOICE_MODEL, voice: env.COSYVOICE_VOICE, configured: false },
    limits: { maxTextCallsPerRun: env.MAX_TEXT_CALLS_PER_RUN, maxImagesPerRun: env.MAX_IMAGES_PER_RUN, maxRealVideoShotsPerRun: env.MAX_REAL_VIDEO_SHOTS_PER_RUN, maxVideoSecondsPerShot: env.MAX_VIDEO_SECONDS_PER_SHOT }
  };
}
function isPubliclyConfigured(_env: RawAIEnv) {
  return true;
}

export function getAIConfig(options: { allowSessionSecrets?: boolean } = {}): AIConfig {
  const env = parseEnv();
  void options;
  return buildConfig(env);
}

export function getPublicAIStatus(): PublicAIStatus {
  const env = parseEnv();
  const config = buildConfig(env);

  return {
    configured: isPubliclyConfigured(env),
    mode: config.mode,
    realTextEnabled: config.realTextEnabled,
    realImageEnabled: config.realImageEnabled,
    realVideoEnabled: config.realVideoEnabled,
    platformKeysAllowed: config.platformKeysAllowed,
    deepseekConfigured: config.deepseek.configured,
    textModel: config.deepseek.model,
    imageConfigured: config.qwenImage.configured,
    imageProvider: "dashscope",
    imageModel: config.qwenImage.imageModel,
    imageSize: config.qwenImage.size,
    imagePromptExtend: config.qwenImage.promptExtend,
    imageWatermark: config.qwenImage.watermark,
    videoProvider: config.video.provider,
    videoModel: config.video.model,
    videoConfigured: config.video.configured,
    videoAssetPath: config.video.assetPath,
    limits: config.limits
  };
}




export type DeepSeekRuntimeConfig = { baseUrl: string; model: string; timeoutMs: number; maxRetries: number };

export function getDeepSeekRuntimeConfig(): DeepSeekRuntimeConfig {
  const env = parseEnv();
  return {
    baseUrl: env.DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL || "deepseek-v4-pro",
    timeoutMs: env.DEEPSEEK_TIMEOUT_MS,
    maxRetries: env.DEEPSEEK_MAX_RETRIES
  };
}



