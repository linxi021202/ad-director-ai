import { NextResponse } from "next/server";

import { assertServerOnly } from "../server-only";

assertServerOnly("HappyHorse validation");

export async function createHappyHorseValidationResponse(manualImportAvailable: boolean) {
  if (manualImportAvailable) {
    return NextResponse.json({
      valid: true,
      capability: "manual-import" as const,
      code: "HAPPYHORSE_MANUAL_IMPORT",
      message: "当前使用 HappyHorse 手动导入模式，无需配置 API Key。"
    });
  }

  return NextResponse.json(
    {
      valid: false,
      capability: "not-configured" as const,
      code: "HAPPYHORSE_NOT_CONFIGURED",
      message: "HappyHorse 远程 API 当前未启用，请使用手动导入视频模式。"
    },
    { status: 409 }
  );
}