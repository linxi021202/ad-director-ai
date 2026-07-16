import { requireApiUser } from "@/lib/auth/api";
import { z } from "zod";

import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { generatePrompts, selectProviderModel } from "../../../lib/providers/providerRouter";
import { adStrategySchema, productBriefSchema, storyboardShotSchema } from "../../../lib/schemas/project";

const requestSchema = z.object({
  brief: productBriefSchema,
  strategy: adStrategySchema,
  shots: z.array(storyboardShotSchema).length(4)
});

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
          trace: { route: "generate-assets", stage: "validation" },
          fallbackUsed: false,
          error: parsed.error.message
        },
        400
      );
    }

    const promptRoute = selectProviderModel({ taskType: "prompt" });
    const imageRoute = selectProviderModel({ taskType: "image", hasChineseText: true });
    const videoRoute = selectProviderModel({ taskType: "video", isHeroShot: true });
    const sessionId = authResult.user.id;
    const result = await generatePrompts(parsed.data.brief, parsed.data.strategy, parsed.data.shots, { sessionId });

    const shots = result.data ?? [];
    const plannedAssets = shots.map((shot) => ({
      shotId: shot.id,
      index: shot.index,
      imagePromptCn: shot.imagePromptCn,
      imagePromptEn: shot.imagePromptEn,
      videoPromptCn: shot.videoPromptCn,
      recommendedModel: shot.recommendedModel,
      fallbackPlan: shot.fallbackPlan,
      imageProvider: imageRoute.model,
      videoProvider: shot.index === 4 ? videoRoute.model : "remotion-image-motion",
      status: "planned"
    }));

    return apiJson({
      success: result.success,
      data: result.success
        ? {
            shots,
            plannedAssets,
            note: "Second stage only plans prompts and assets. It does not call Qwen-Image or HappyHorse."
          }
        : null,
      trace: {
        route: "generate-assets",
        taskType: "prompt",
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        tokenUsage: result.tokenUsage,
        costEstimate: result.costEstimate,
        plannedRoutes: {
          prompt: promptRoute,
          image: imageRoute,
          video: videoRoute
        }
      },
      fallbackUsed: result.fallbackUsed,
      fallbackReason: result.fallbackReason,
      error: result.error
    });
  } catch (error) {
    return apiJson(
      {
        success: false,
        data: null,
        trace: { route: "generate-assets", stage: "exception" },
        fallbackUsed: false,
        error: sanitizeApiError(error)
      },
      500
    );
  }
}

