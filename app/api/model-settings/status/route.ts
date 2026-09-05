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
  const wanApiAvailable = getAIConfig({ allowSessionSecrets: true }).realVideoEnabled
    && qwenImage.configured;

  return NextResponse.json({
    deepseek,
    qwenImage,
    wan: {
      capability: wanApiAvailable ? "api-available" as const : "not-configured" as const,
      apiAvailable: wanApiAvailable
    },
    remotion: {
      source: "local" as const
    }
  });
}
