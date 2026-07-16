import { requireApiUser } from "@/lib/auth/api";
import { z } from "zod";

import { diagnoseProviderFallback } from "../../../lib/api/provider-diagnostics";
import { apiJson, sanitizeApiError } from "../../../lib/api/response";
import { generateStrategy, selectProviderModel } from "../../../lib/providers/providerRouter";
import { productBriefSchema } from "../../../lib/schemas/project";

const requestSchema = z.object({
  brief: productBriefSchema
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
          trace: { route: "generate-strategy", stage: "validation" },
          fallbackUsed: false,
          error: parsed.error.message
        },
        400
      );
    }

    const route = selectProviderModel({ taskType: "strategy" });
    const sessionId = authResult.user.id;
    const result = await generateStrategy(parsed.data.brief, { sessionId });

    return apiJson({
      success: result.success,
      data: result.success ? { strategy: result.data } : null,
      trace: {
        route: "generate-strategy",
        taskType: "strategy",
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        tokenUsage: result.tokenUsage,
        costEstimate: result.costEstimate,
        plannedRoute: route,
        diagnostic: result.fallbackUsed || result.error ? diagnoseProviderFallback(result.fallbackReason ?? result.error) : null
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
        trace: { route: "generate-strategy", stage: "exception" },
        fallbackUsed: false,
        error: sanitizeApiError(error)
      },
      500
    );
  }
}
