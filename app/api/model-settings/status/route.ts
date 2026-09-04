import { NextResponse } from "next/server";

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

  return NextResponse.json({
    deepseek,
    qwenImage,
    happyHorse: {
      capability: "manual-import" as const,
      apiAvailable: false
    },
    remotion: {
      source: "local" as const
    }
  });
}
