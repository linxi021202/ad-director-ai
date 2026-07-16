import { NextResponse } from "next/server";

import { getAIConfig } from "../config/ai";
import { getHappyHorseCapability } from "../providers/happyHorseCapability";
import { getProviderSecretStatus } from "../secrets/resolver";
import { assertServerOnly } from "../server-only";

assertServerOnly("HappyHorse validation");

export async function createHappyHorseValidationResponse(manualImportAvailable: boolean, ownerId = "") {
  const sessionId = ownerId;
  const config = getAIConfig({ allowSessionSecrets: true });
  const secret = await getProviderSecretStatus("happyhorse", sessionId);
  const capability = getHappyHorseCapability(manualImportAvailable, config.realVideoEnabled && secret.configured);

  if (capability.capability === "api-available") {
    return NextResponse.json({
      valid: true,
      capability: "api-available" as const,
      code: "HAPPYHORSE_API_AVAILABLE",
      message: "HappyHorse 真实调用已启用，百炼 Key 已在服务端可用。"
    });
  }

  if (capability.capability === "manual-import") {
    return NextResponse.json({
      valid: true,
      capability: "manual-import" as const,
      code: "HAPPYHORSE_MANUAL_IMPORT",
      message: "当前使用 HappyHorse 手动导入模式；如需真实调用，请开启 ENABLE_REAL_VIDEO=true 并保存百炼 Key。"
    });
  }

  return NextResponse.json(
    {
      valid: false,
      capability: "not-configured" as const,
      code: "HAPPYHORSE_NOT_CONFIGURED",
      message: "HappyHorse 当前未配置。请保存百炼 Key，或使用手动导入视频模式。"
    },
    { status: 409 }
  );
}
