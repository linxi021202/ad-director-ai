import { requireApiUser } from "@/lib/auth/api";
import { NextResponse } from "next/server";

import { getAIConfig } from "../../../../lib/config/ai";
import { getHappyHorseCapability } from "../../../../lib/providers/happyHorseCapability";
import { getProviderSecretStatus } from "../../../../lib/secrets/resolver";

export async function GET() {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;

  const ownerId = authResult.user.id;
  const config = getAIConfig({ allowSessionSecrets: true });
  const [deepseek, qwenImage, happyHorseSecret] = await Promise.all([
    getProviderSecretStatus("deepseek", ownerId),
    getProviderSecretStatus("qwen-image", ownerId),
    getProviderSecretStatus("happyhorse", ownerId)
  ]);
  const apiAvailable = config.realVideoEnabled && happyHorseSecret.configured;
  const capability = getHappyHorseCapability(true, apiAvailable);

  return NextResponse.json({
    deepseek,
    qwenImage,
    happyHorse: {
      ...happyHorseSecret,
      capability: capability.capability,
      apiAvailable: capability.apiAvailable,
      realVideoEnabled: config.realVideoEnabled
    },
    remotion: { configured: false, source: "local" as const, status: "not-installed" as const }
  });
}