import { NextResponse } from "next/server";

import { getAIConfig } from "@/lib/config/ai";
import { getProviderSecretStatus } from "@/lib/secrets/resolver";
import { getAnonymousApiSession } from "@/lib/session/api";

export async function GET() {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;

  const [deepseek, qwenImage] = await Promise.all([
    getProviderSecretStatus("deepseek", session.id),
    getProviderSecretStatus("qwen-image", session.id)
  ]);
  const happyHorseApiAvailable = getAIConfig({ allowSessionSecrets: true }).realVideoEnabled
    && qwenImage.configured;

  return NextResponse.json({
    deepseek,
    qwenImage,
    happyHorse: {
      capability: happyHorseApiAvailable ? "api-available" as const : "not-configured" as const,
      apiAvailable: happyHorseApiAvailable
    },
    remotion: {
      source: "local" as const
    }
  });
}
