import { requireApiUser } from "@/lib/auth/api";
import { z } from "zod";

import { diagnoseQwenImageFallback } from "../../../lib/api/provider-diagnostics";
import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { getPublicAIStatus } from "../../../lib/config/ai";
import { selectPrimaryProductImage } from "../../../lib/image/productReference";
import { generateBatchShotImages, selectProviderModel } from "../../../lib/providers/providerRouter";
import { aspectRatioSchema, productImageSchema, storyboardShotSchema } from "../../../lib/schemas/project";

const requestSchema = z.object({
  projectId: z.string().min(1),
  shots: z.array(storyboardShotSchema).min(1).max(4),
  mode: z.enum(["hero-only", "all-shots"]),
  aspectRatio: aspectRatioSchema.optional().default("9:16"),
  productImages: z.array(productImageSchema).max(3).optional()
});

function selectTargetShots(shots: z.infer<typeof storyboardShotSchema>[], mode: "hero-only" | "all-shots", maxImagesPerRun: number) {
  if (mode === "hero-only") {
    return [shots.find((shot) => shot.index === 3) ?? shots[2] ?? shots[0]];
  }

  return shots.slice(0, Math.min(4, maxImagesPerRun));
}

export async function POST(request: Request) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return apiJson(
        {
          success: false,
          data: null,
          trace: { route: "generate-images", stage: "validation" },
          fallbackUsed: false,
          error: parsed.error.message
        },
        400
      );
    }

    const publicStatus = getPublicAIStatus();
    const sessionId = authResult.user.id;
    const maxImagesPerRun = publicStatus.limits.maxImagesPerRun;
    const targetShots = selectTargetShots(parsed.data.shots, parsed.data.mode, maxImagesPerRun);
    const imageRoute = selectProviderModel({ taskType: "image", hasChineseText: true });
    const productImage = selectPrimaryProductImage(parsed.data.productImages);
    const results = await generateBatchShotImages(parsed.data.projectId, targetShots, {
      aspectRatio: parsed.data.aspectRatio,
      hasChineseText: true,
      sessionId,
      productImage
    });

    const images = results.map((result) => {
      const diagnostic = result.fallbackUsed ? diagnoseQwenImageFallback(result.fallbackReason ?? result.error) : null;

      return {
        shotId: result.shotId,
        imageUrl: result.imageUrl,
        localUrl: result.localUrl,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        requestId: result.requestId,
        size: result.size,
        cacheStatus: result.cacheStatus,
        fallbackUsed: result.fallbackUsed,
        fallbackReason: result.fallbackReason ?? null,
        referenceUsed: result.referenceUsed ?? false,
        diagnostic
      };
    });

    const failedShots = images
      .filter((image) => image.fallbackUsed)
      .map((image) => ({
        shotId: image.shotId,
        fallbackReason: image.fallbackReason ?? "Image generation used fallback.",
        diagnostic: image.diagnostic
      }));

    return apiJson({
      success: true,
      data: {
        images,
        failedShots,
        mode: parsed.data.mode,
        requestedShots: parsed.data.shots.length,
        generatedShots: images.length
      },
      trace: {
        route: "generate-images",
        taskType: "image",
        mode: parsed.data.mode,
        provider: imageRoute.provider,
        model: imageRoute.model,
        maxImagesPerRun,
        sessionConfigured: Boolean(sessionId),
        productReferenceRequested: Boolean(productImage),
        productReferenceUsed: images.some((image) => image.referenceUsed),
        generatedShotIds: images.map((image) => image.shotId),
        diagnostics: failedShots.map((shot) => ({
          shotId: shot.shotId,
          title: shot.diagnostic?.title ?? "原因未识别",
          hint: shot.diagnostic?.hint ?? "可重试单镜头生成。"
        })),
        note: "Third stage only generates keyframe images. It does not call video or render APIs."
      },
      fallbackUsed: failedShots.length > 0,
      fallbackReason: failedShots.length > 0 ? `${failedShots.length} shot image(s) used placeholder fallback.` : null,
      error: null
    });
  } catch (error) {
    return apiJson(
      {
        success: false,
        data: null,
        trace: { route: "generate-images", stage: "exception" },
        fallbackUsed: false,
        error: sanitizeApiError(error)
      },
      500
    );
  }
}
