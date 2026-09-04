import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sanitizeProviderError } from "@/lib/api/provider-error";
import { getAIConfig, getDeepSeekRuntimeConfig } from "@/lib/config/ai";
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

  if (isRateLimited(`${session.id}:validate`, 6)) {
    return NextResponse.json({ valid: false, message: "验证过于频繁，请稍后重试。" }, { status: 429 });
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
  const path = provider.data === "deepseek" ? "/models" : "/api/v1/models";
  let valid = false;

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000)
    });
    valid = response.ok;
  } catch (error) {
    sanitizeProviderError(error, provider.data);
  }

  if (!submittedKey && saved.source === "session") {
    await secretStore.setValidated(session.id, provider.data, valid);
  }

  const message = valid
    ? "连接验证成功。"
    : provider.data === "deepseek"
      ? "DeepSeek 验证失败，请检查密钥、额度或服务状态。"
      : "Qwen-Image 验证失败，请检查密钥、工作空间或服务状态。";

  return NextResponse.json({ valid, message });
}
