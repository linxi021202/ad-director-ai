import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAIConfig, getDeepSeekRuntimeConfig } from "@/lib/config/ai";
import { validateProviderConnection } from "@/lib/secrets/providerValidation";
import { resolveSessionProviderSecret } from "@/lib/secrets/resolver";
import { isPlausibleApiKey, isRateLimited, isSameOrigin } from "@/lib/secrets/security";
import { secretStore } from "@/lib/secrets/store";
import { configurableProviders } from "@/lib/secrets/types";
import { getAnonymousApiSession } from "@/lib/session/api";

const providerSchema = z.enum(configurableProviders);
const bodySchema = z.object({ apiKey: z.string().optional() }).optional();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;

  if (!isSameOrigin(request)) {
    return NextResponse.json({ valid: false, message: "请求来源无效。" }, { status: 403 });
  }

  const provider = providerSchema.safeParse((await context.params).provider);
  if (!provider.success) {
    return NextResponse.json({ valid: false, message: "未知模型服务。" }, { status: 400 });
  }

  if (isRateLimited(`${session.id}:validate:${provider.data}`, 8)) {
    return NextResponse.json({
      valid: false,
      usable: false,
      code: "LOCAL_RATE_LIMITED",
      message: "测试连接过于频繁，请等待一分钟后重试。"
    }, { status: 429 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => undefined));
  const submittedKey = body.success ? body.data?.apiKey?.trim() : undefined;
  if (submittedKey && !isPlausibleApiKey(submittedKey)) {
    return NextResponse.json({ valid: false, message: "密钥格式无效。" }, { status: 400 });
  }

  const saved = await resolveSessionProviderSecret({
    sessionId: session.id,
    provider: provider.data
  });
  const apiKey = submittedKey || saved.value;
  if (!apiKey) {
    return NextResponse.json({
      valid: false,
      message: saved.message ?? "请先配置模型 API Key。"
    }, { status: 409 });
  }

  const deepSeekRuntime = getDeepSeekRuntimeConfig();
  const imageConfig = getAIConfig({ allowSessionSecrets: true }).qwenImage;
  const baseUrl = provider.data === "deepseek" ? deepSeekRuntime.baseUrl : imageConfig.baseUrl;
  const validation = await validateProviderConnection({
    provider: provider.data,
    apiKey,
    baseUrl
  });

  if (!submittedKey && saved.source === "session" && validation.conclusive) {
    await secretStore.setValidated(session.id, provider.data, validation.valid);
  }

  return NextResponse.json({
    valid: validation.valid,
    usable: validation.usable,
    code: validation.code,
    message: validation.message
  });
}
