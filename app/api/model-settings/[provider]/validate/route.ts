import { requireApiUser } from "@/lib/auth/api";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sanitizeProviderError } from "../../../../../lib/api/provider-error";
import { createHappyHorseValidationResponse } from "../../../../../lib/api/happyhorse-validation";
import { getDeepSeekRuntimeConfig, getAIConfig } from "../../../../../lib/config/ai";
import { resolveProviderSecret } from "../../../../../lib/secrets/resolver";
import { isRateLimited, isSameOrigin } from "../../../../../lib/secrets/security";
import { secretStore } from "../../../../../lib/secrets/store";
import { configurableProviders } from "../../../../../lib/secrets/types";

const providerSchema = z.enum(configurableProviders);

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  if (!isSameOrigin(request)) {
    return NextResponse.json({ valid: false, message: "Invalid request origin." }, { status: 403 });
  }

  const provider = providerSchema.safeParse((await context.params).provider);
  if (!provider.success) {
    return NextResponse.json({ valid: false, message: "Unknown model provider." }, { status: 400 });
  }

  if (provider.data === "happyhorse") return await createHappyHorseValidationResponse(true, authResult.user.id);

  const sessionId = authResult.user.id;
  if (isRateLimited(`${sessionId || "env"}:validate`, 6)) {
    return NextResponse.json({ valid: false, message: "Validation is too frequent. Try again later." }, { status: 429 });
  }

  const secret = await resolveProviderSecret(provider.data, sessionId);
  if (!secret.value) {
    return NextResponse.json({ valid: false, message: "API key is not configured." }, { status: 409 });
  }

  const deepSeekRuntime = getDeepSeekRuntimeConfig();
  const imageConfig = getAIConfig({ allowSessionSecrets: true }).qwenImage;
  const baseUrl = provider.data === "deepseek" ? deepSeekRuntime.baseUrl : imageConfig.baseUrl;
  const path = provider.data === "deepseek" ? "/models" : "/api/v1/models";
  let valid = false;

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      headers: { Authorization: `Bearer ${secret.value}` },
      signal: AbortSignal.timeout(8_000)
    });
    valid = response.ok;
  } catch (error) {
    sanitizeProviderError(error, provider.data);
  }

  if (sessionId) await secretStore.setValidated(sessionId, provider.data, valid);
  const message = valid
    ? "Connection validated."
    : provider.data === "deepseek"
      ? "DeepSeek validation failed. Check API key, quota, or service status."
      : "Qwen-Image validation failed. Check API key, workspace, or service status.";

  return NextResponse.json({ valid, message });
}
