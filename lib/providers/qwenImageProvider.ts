import { callQwenImage } from "../image/qwenImageClient";
import { composeExactProductAsset } from "../image/exactProductComposite";
import { estimateQwenImageCost } from "../image/imageCostEstimate";
import { markPrivateAssetsLifecycle } from "../assets/assetStore";
import { readContinuityReferenceDataUrl, readPrivateVisualAssetDataUrl, readProductReferenceDataUrl } from "../image/productReference";
import type { ProductVisualSpec, StoryboardShot } from "../schemas/project";
import { inferProductShotType, shotContainsProduct } from "../continuity/projectContinuity";
import { serializeProductVisualSpecForPrompt } from "../visual/productVisualSpec";
import { appendNoReadableTextRules, NO_READABLE_TEXT_NEGATIVE } from "../prompts/noReadableText";
import { repairShotProductTerminology } from "../visual/productTerminology";
import {
  appendSingleFrameConstraint,
  SINGLE_COMPOSITION_NEGATIVE_PROMPT
} from "../prompts/singleComposition";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageProvider,
  ProviderResponse,
  ShotImageGenerationResult
} from "./types";

export const QWEN_IMAGE_PLACEHOLDER_URL = "/landing-cold-brew-hero.png";
export const DEFAULT_QWEN_NEGATIVE_PROMPT =
  `低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感，构图混乱，产品包装变形，Logo错误，${SINGLE_COMPOSITION_NEGATIVE_PROMPT}，${NO_READABLE_TEXT_NEGATIVE}`;
export const PRODUCT_REFERENCE_QWEN_NEGATIVE_PROMPT =
  `低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感，构图混乱，产品包装变形，${SINGLE_COMPOSITION_NEGATIVE_PROMPT}，新增文字，背景文字，字幕，标题，CTA，水印，伪文字，乱码，随机字符，扭曲单词，错误品牌文字`;

function withCacheBuster(url: string | undefined, seed: string | undefined) {
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  const token = encodeURIComponent(seed || Date.now().toString());
  return `${url}${url.includes("?") ? "&" : "?"}v=${token}`;
}

function shotFallbackImage(shot: StoryboardShot) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600" viewBox="0 0 900 1600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#112946"/><stop offset="0.52" stop-color="#1d3562"/><stop offset="1" stop-color="#34265d"/></linearGradient></defs><rect width="900" height="1600" fill="url(#g)"/><circle cx="${160 + shot.index * 92}" cy="${280 + shot.index * 38}" r="180" fill="#38d5ff" opacity="0.2"/><circle cx="690" cy="1180" r="250" fill="#f7d477" opacity="0.08"/><rect x="80" y="1080" width="740" height="220" rx="42" fill="#070b18" opacity="0.42"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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

export function buildShotPrompt(shot: StoryboardShot, preserveProductLabel = false): string {
  const basePrompt = appendSingleFrameConstraint(
    (shot.imagePromptCn || shot.imagePromptEn || shot.visualDescription).trim()
  );
  const prompt = [
    basePrompt,
    "按项目设定画幅生成广告关键帧，高级商业摄影，产品外观清晰稳定，包装可读区域不得由模型重绘。",
    "画面需要可作为后续 Remotion 图片动效素材，主体明确，留出安全字幕区。",
    "禁止明星肖像、影视 IP、竞品 Logo、虚假功效承诺。"
  ].filter(Boolean).join("\n");

  if (!preserveProductLabel) return appendNoReadableTextRules(prompt);
  return [
    prompt,
    "除用户上传真实产品图中原本存在的包装品牌文字外，画面任何其他区域都不得出现可读文字、字幕、标题、字母、数字、水印、招牌或随机字符。",
    "本条禁字要求优先级最高：忽略基础分镜描述中任何要求生成标题、卖点、字幕、数字、标语、CTA 或背景文字的内容。",
    "真实产品包装上的原有品牌文字必须作为不可修改的图像纹理原样保留，且只能来自源产品像素；不得重新书写、翻译、替换、补全或变形。无法准确保留时，宁可让该区域自然虚化，也不要生成伪文字或乱码。",
    "所有广告标题、卖点、字幕与 CTA 均由 Remotion 后期添加。",
    "no added readable text outside the supplied real product label, no subtitles, no typography, no watermark, no pseudo-text, no random symbols, no distorted words; preserve the original product-label pixels without rewriting them"
  ].join("\n");
}

function fallbackShotImage(
  shot: StoryboardShot,
  prompt: string,
  fallbackReason: string,
  latencyMs: number,
  errorCode?: string
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
    ...(errorCode ? { errorCode } : {}),
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
  let productReferenceImage: string | undefined;
  let continuityReferenceImage: string | undefined;
  const masterReferenceImages: string[] = [];
  const containsProduct = shotContainsProduct(shot);
  const productAssetId = options?.productImage?.assetId;
  const safeShot = repairShotProductTerminology(shot, options?.productVisualSpec);
  const productShotType = safeShot.productShotType ?? inferProductShotType(safeShot, Number.MAX_SAFE_INTEGER);
  const productFidelityMode = containsProduct ? (safeShot.productFidelityMode ?? "exact") : "not-visible";

  const productGate = validateProductReferenceForShot(shot, productAssetId, options?.productVisualSpec);
  if (!productGate.valid) {
    return fallbackShotImage(
      shot,
      buildShotPrompt(shot),
      productGate.message,
      Date.now() - startedAt,
      productGate.errorCode
    );
  }

  if (containsProduct && productFidelityMode === "exact" && productShotType === "packshot") {
    const localUrl = options?.productImage?.localUrl;
    if (productAssetId && localUrl) {
      return {
        shotId: shot.id,
        imageUrl: localUrl,
        localUrl,
        assetId: productAssetId,
        prompt: buildShotPrompt(safeShot, true),
        provider: "deterministic-product-master",
        model: "remotion-exact-product",
        latencyMs: Date.now() - startedAt,
        size: getSizeForAspectRatio(options?.aspectRatio),
        cacheStatus: "cached",
        fallbackUsed: false,
        referenceUsed: true,
        error: null
      };
    }
  }

  const requiresExactComposite = containsProduct && productFidelityMode === "exact" && productShotType !== "packshot";
  const generationShot: StoryboardShot = requiresExactComposite ? {
    ...safeShot,
    containsProduct: false,
    productIds: [],
    imagePromptCn: `${safeShot.visualDescription}\n生成不含产品的真实广告场景底图。在画面下方前景保留干净、无遮挡、无文字的产品放置区域；人物最多只做伸手靠近动作，不握持、不遮挡、不重画产品。屏幕、海报、文件与招牌保持空白或完全失焦。`,
    imagePromptEn: "Generate the scene background without any product. Reserve one clean unobstructed product placement area in the lower foreground. A person may only reach toward that empty area, without holding or occluding a product. Screens, posters, documents and signs are blank or fully defocused."
  } : safeShot;

  try {
    productReferenceImage = requiresExactComposite ? undefined : await readProductReferenceDataUrl(options?.productImage, { sessionId: options?.sessionId, projectId });
    if (!requiresExactComposite && options?.productImage && !productReferenceImage) {
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
  try {
    continuityReferenceImage = await readContinuityReferenceDataUrl(options?.continuityImageAssetId, {
      sessionId: options?.sessionId,
      projectId
    });
  } catch {
    // Continuity is auxiliary. A stale previous frame must not block the current shot.
    continuityReferenceImage = undefined;
  }

  for (const assetId of options?.masterReferenceAssetIds ?? []) {
    if (assetId === productAssetId || assetId === options?.continuityImageAssetId) continue;
    try {
      masterReferenceImages.push(await readPrivateVisualAssetDataUrl(assetId, {
        sessionId: options?.sessionId ?? "",
        projectId
      }));
    } catch {
      // A missing optional master is reported by QA; it does not replace Product Master.
    }
  }

  const referenceEntries = [
    ...(productReferenceImage ? [{ image: productReferenceImage, role: "product" as const }] : []),
    ...masterReferenceImages.map((image) => ({ image, role: "master" as const })),
    ...(continuityReferenceImage ? [{ image: continuityReferenceImage, role: "continuity" as const }] : [])
  ].slice(0, 3);
  const referenceImages = referenceEntries.map((entry) => entry.image);
  const hasProductReference = referenceEntries.some((entry) => entry.role === "product");
  const continuityReferenceIndex = referenceEntries.findIndex((entry) => entry.role === "continuity");
  const masterReferenceIndexes = referenceEntries
    .map((entry, index) => entry.role === "master" ? index + 1 : 0)
    .filter(Boolean);

  const prompt = [
    buildShotPrompt(generationShot, hasProductReference),
    containsProduct ? serializeProductVisualSpecForPrompt(options?.productVisualSpec) : "",
    hasProductReference
      ? [
          "图1是用户上传的真实产品图，是产品容器形状、包装、材质、颜色和标签纹理的唯一权威参考。",
          "Treat the existing product and package label as immutable source-image texture. Preserve its original brand marks and lettering without regenerating, translating or retyping them.",
          "Do not add text anywhere else. If exact label preservation is impossible, keep that small label region naturally soft instead of inventing pseudo-text.",
          "You may change the scene, camera angle and lighting, but must not redesign, replace or distort the product.",
          "Keep the real product clearly recognizable and commercially usable in the final advertising keyframe."
        ].join("\n")
      : "",
    continuityReferenceIndex >= 0
      ? [
          `图${continuityReferenceIndex + 1}是同一连续性组的上一镜关键帧，只用于继承人物身份、服装、产品状态、主要道具和光线方向。`,
          "必须生成当前镜头描述的新画面，不得复制上一镜的背景、构图、机位或人物姿态。当前镜头与上一镜在景别、摄影机轴位、人物动作、产品使用阶段中至少改变两项。",
          "Previous-shot reference is an auxiliary continuity anchor, not a composition template. Preserve identity and state while creating a clearly different next shot."
        ].join("\n")
      : "",
    masterReferenceIndexes.length
      ? `图${masterReferenceIndexes.join("、图")}是已锁定的 Character Master 或 Scene Master，只用于锁定人物身份、服装、场景结构、道具和光线；不得复制其构图。`
      : ""
  ].filter(Boolean).join("\n");

  const result = await callQwenImage({
    prompt,
    ...(referenceImages.length ? { referenceImages } : {}),
    model: referenceImages.length ? process.env.QWEN_IMAGE_EDIT_MODEL || "qwen-image-2.0" : undefined,
    negativePrompt: hasProductReference ? PRODUCT_REFERENCE_QWEN_NEGATIVE_PROMPT : DEFAULT_QWEN_NEGATIVE_PROMPT,
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

  if (requiresExactComposite) {
    if (!result.assetId || !productAssetId || !options?.sessionId) {
      return fallbackShotImage(safeShot, prompt, "EXACT_PRODUCT_COMPOSITE_REQUIRED：场景底图或 Product Master 私有资产不可用。", result.latencyMs || Date.now() - startedAt, "EXACT_PRODUCT_COMPOSITE_REQUIRED");
    }
    try {
      const composite = await composeExactProductAsset({
        sessionId: options.sessionId,
        projectId,
        backgroundAssetId: result.assetId,
        productAssetId,
        shotId: safeShot.id,
        aspectRatio: options.aspectRatio ?? "9:16",
        shotType: productShotType
      });
      await markPrivateAssetsLifecycle(options.sessionId, projectId, [result.assetId], "orphaned");
      return {
        shotId: safeShot.id,
        imageUrl: composite.localUrl,
        localUrl: composite.localUrl,
        assetId: composite.assetId,
        prompt,
        provider: "deterministic-product-composite",
        model: "qwen-background-plus-source-product",
        latencyMs: result.latencyMs,
        requestId: result.requestId,
        size: `${composite.width}*${composite.height}`,
        cacheStatus: "cached",
        fallbackUsed: false,
        costEstimate: result.costEstimate,
        referenceUsed: true,
        error: null
      };
    } catch (error) {
      return fallbackShotImage(safeShot, prompt, `EXACT_PRODUCT_COMPOSITE_REQUIRED：${error instanceof Error ? error.message : "真实产品合成失败"}`, Date.now() - startedAt, "EXACT_PRODUCT_COMPOSITE_REQUIRED");
    }
  }

  const versionSeed = result.requestId || `${shot.id}-${Date.now()}`;
  const remoteUrl = result.imageUrl;
  const localUrl = withCacheBuster(result.localUrl, versionSeed);

  return {
    shotId: safeShot.id,
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

export function validateProductReferenceForShot(
  shot: StoryboardShot,
  productAssetId?: string,
  productVisualSpec?: ProductVisualSpec
): { valid: true } | { valid: false; errorCode: string; message: string } {
  if (!shotContainsProduct(shot)) return { valid: true };
  if (!productAssetId) {
    return { valid: false, errorCode: "PRODUCT_REFERENCE_REQUIRED", message: "PRODUCT_REFERENCE_REQUIRED：该镜头包含产品，但没有可用的 Product Master 私有资产。" };
  }
  if (!shot.referenceImageAssetIds?.includes(productAssetId)) {
    return { valid: false, errorCode: "PRODUCT_REFERENCE_REQUIRED", message: "PRODUCT_REFERENCE_REQUIRED：该镜头未显式绑定当前 Product Master 资产 ID。" };
  }
  if (!productVisualSpec || productVisualSpec.sourceAssetId !== productAssetId) {
    return { valid: false, errorCode: "PRODUCT_VISUAL_SPEC_REQUIRED", message: "PRODUCT_VISUAL_SPEC_REQUIRED：当前 Product Master 尚未完成 qwen3.7-plus 视觉规格提取。" };
  }
  return { valid: true };
}

async function generateBatchShotImages(
  projectId: string,
  shots: StoryboardShot[],
  options: ImageGenerationOptions = { aspectRatio: "9:16", hasChineseText: true }
): Promise<ShotImageGenerationResult[]> {
  const results: ShotImageGenerationResult[] = [];
  const previousAssetByGroup = new Map<string, string>();
  for (const shot of shots) {
    const groupId = shot.continuityGroupId ?? shot.sceneGroupId;
    const result = await generateShotImage(projectId, shot, {
      ...options,
      continuityImageAssetId: groupId
        ? previousAssetByGroup.get(groupId) ?? options.continuityImageAssetId
        : undefined
    });
    results.push(result);
    if (groupId && result.assetId && !result.fallbackUsed) previousAssetByGroup.set(groupId, result.assetId);
  }

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
