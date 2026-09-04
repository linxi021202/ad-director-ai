import { callQwenImage } from "../image/qwenImageClient";
import { estimateQwenImageCost } from "../image/imageCostEstimate";
import { readProductReferenceDataUrl } from "../image/productReference";
import type { StoryboardShot } from "../schemas/project";
import { appendNoReadableTextRules, NO_READABLE_TEXT_NEGATIVE } from "../prompts/noReadableText";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageProvider,
  ProviderResponse,
  ShotImageGenerationResult
} from "./types";

export const QWEN_IMAGE_PLACEHOLDER_URL = "/landing-cold-brew-hero.png";
export const DEFAULT_QWEN_NEGATIVE_PROMPT =
  `低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感，构图混乱，产品包装变形，Logo错误，${NO_READABLE_TEXT_NEGATIVE}`;

function withCacheBuster(url: string | undefined, seed: string | undefined) {
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  const token = encodeURIComponent(seed || Date.now().toString());
  return `${url}${url.includes("?") ? "&" : "?"}v=${token}`;
}

function shotFallbackImage(shot: StoryboardShot) {
  const title = `Shot ${shot.index}`;
  const subtitle = (shot.subtitle || shot.goal || "关键帧降级").slice(0, 18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600" viewBox="0 0 900 1600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#112946"/><stop offset="0.52" stop-color="#1d3562"/><stop offset="1" stop-color="#34265d"/></linearGradient></defs><rect width="900" height="1600" fill="url(#g)"/><circle cx="${160 + shot.index * 92}" cy="${280 + shot.index * 38}" r="180" fill="#38d5ff" opacity="0.2"/><rect x="80" y="1080" width="740" height="220" rx="42" fill="#070b18" opacity="0.58"/><text x="100" y="1170" fill="#85e8ff" font-size="44" font-family="Arial, sans-serif" font-weight="700">${escapeSvg(title)}</text><text x="100" y="1248" fill="#ffffff" font-size="56" font-family="Arial, sans-serif" font-weight="800">${escapeSvg(subtitle)}</text><text x="100" y="1322" fill="#b8c4dc" font-size="28" font-family="Arial, sans-serif">Fallback keyframe placeholder</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvg(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" }[char] ?? char));
}

function getDefaultModel() {
  return process.env.QWEN_IMAGE_MODEL || "qwen-image";
}

function getDefaultSize() {
  return process.env.QWEN_IMAGE_SIZE || "1152*2048";
}
function getSizeForAspectRatio(aspectRatio: ImageGenerationOptions["aspectRatio"] = "9:16") {
  if (aspectRatio === "16:9") return "2048*1152";
  if (aspectRatio === "1:1") return "2048*2048";
  return getDefaultSize();
}

function buildShotPrompt(shot: StoryboardShot): string {
  const basePrompt = (shot.imagePromptCn || shot.imagePromptEn || shot.visualDescription).trim();
  const prompt = [
    basePrompt,
    "9:16竖版广告关键帧，小红书/抖音竖版短视频质感，高级商业摄影，产品外观清晰稳定，包装可读区域不得由模型重绘。",
    "画面需要可作为后续 Remotion 图片动效素材，主体明确，留出安全字幕区。",
    "禁止明星肖像、影视 IP、竞品 Logo、虚假功效承诺。"
  ].filter(Boolean).join("\n");

  return appendNoReadableTextRules(prompt);
}

function fallbackShotImage(
  shot: StoryboardShot,
  prompt: string,
  fallbackReason: string,
  latencyMs: number
): ShotImageGenerationResult {
  return {
    shotId: shot.id,
    imageUrl: shotFallbackImage(shot),
    localUrl: shotFallbackImage(shot),
    prompt,
    provider: "placeholder",
    model: getDefaultModel(),
    latencyMs,
    size: getDefaultSize(),
    cacheStatus: "not-requested",
    fallbackUsed: true,
    fallbackReason,
    costEstimate: estimateQwenImageCost(getDefaultSize()),
    error: fallbackReason
  };
}

async function generateShotImage(
  projectId: string,
  shot: StoryboardShot,
  options?: ImageGenerationOptions
): Promise<ShotImageGenerationResult> {
  const startedAt = Date.now();
  let referenceImage: string | undefined;

  try {
    referenceImage = await readProductReferenceDataUrl(options?.productImage, { sessionId: options?.sessionId, projectId });
    if (options?.productImage && !referenceImage) {
      throw new Error("The selected product image is not persisted on the server.");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The product reference could not be loaded.";
    return fallbackShotImage(
      shot,
      buildShotPrompt(shot),
      `Qwen-Image product-reference preparation failed for shot ${shot.index}: ${reason} Used placeholder image fallback.`,
      Date.now() - startedAt
    );
  }

  const prompt = [
    buildShotPrompt(shot),
    referenceImage
      ? [
          "Use the supplied real product image as the only authoritative product reference.",
          "Preserve the package structure, silhouette, materials, colors and proportions, but do not synthesize or redraw readable package text or logo text.",
          "You may change the scene, camera angle and lighting, but must not redesign, replace or distort the product.",
          "Keep the real product clearly recognizable and commercially usable in the final advertising keyframe."
        ].join("\n")
      : ""
  ].filter(Boolean).join("\n");

  const result = await callQwenImage({
    prompt,
    referenceImage,
    model: referenceImage ? process.env.QWEN_IMAGE_EDIT_MODEL || "qwen-image-2.0" : undefined,
    negativePrompt: DEFAULT_QWEN_NEGATIVE_PROMPT,
    projectId,
    shotId: shot.id,
    size: getSizeForAspectRatio(options?.aspectRatio),
    sessionId: options?.sessionId
  });

  if (!result.success) {
    return fallbackShotImage(
      shot,
      prompt,
      `Qwen-Image keyframe generation failed for shot ${shot.index}: ${result.error ?? "unknown error"}. Used placeholder image fallback.`,
      result.latencyMs || Date.now() - startedAt
    );
  }

  const versionSeed = result.requestId || `${shot.id}-${Date.now()}`;
  const remoteUrl = result.imageUrl;
  const localUrl = withCacheBuster(result.localUrl, versionSeed);

  return {
    shotId: shot.id,
    imageUrl: localUrl || QWEN_IMAGE_PLACEHOLDER_URL,
    assetId: result.assetId,
    localUrl,
    prompt,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    requestId: result.requestId,
    size: result.size,
    cacheStatus: result.cacheStatus ?? "remote-only",
    fallbackUsed: false,
    costEstimate: result.costEstimate,
    referenceUsed: result.referenceUsed,
    error: null
  };
}

async function generateBatchShotImages(
  projectId: string,
  shots: StoryboardShot[],
  options?: ImageGenerationOptions
): Promise<ShotImageGenerationResult[]> {
  const results = new Array<ShotImageGenerationResult>(shots.length);
  let cursor = 0;
  const workerCount = Math.min(2, shots.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < shots.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await generateShotImage(projectId, shots[index]!, options);
    }
  }));

  return results;
}

export const qwenImageProvider: ImageProvider = {
  provider: "qwenImageProvider",
  async generateImage(prompt: string, options: ImageGenerationOptions): Promise<ProviderResponse<ImageGenerationResult>> {
    const result = await callQwenImage({
      prompt: appendNoReadableTextRules([
        prompt,
        "9:16竖版广告关键帧，小红书/抖音短视频质感，产品外观清晰稳定，包装可读区域不得由模型重绘。"
      ].join("\n")),
      negativePrompt: DEFAULT_QWEN_NEGATIVE_PROMPT,
      size: getSizeForAspectRatio(options.aspectRatio),
      sessionId: options.sessionId
    });

    return {
      success: result.success,
      data: result.success
        ? {
            imageUrl: result.localUrl || result.imageUrl || QWEN_IMAGE_PLACEHOLDER_URL,
            prompt
          }
        : null,
      provider: result.provider,
      model: result.model,
      costEstimate: 0.24,
      latencyEstimate: `${result.latencyMs}ms`,
      error: result.error ?? null
    };
  },
  generateShotImage,
  generateBatchShotImages
};
