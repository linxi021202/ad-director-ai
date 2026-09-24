import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isRateLimited, isSameOrigin } from "@/lib/secrets/security";
import { clearQwenModelAvailability } from "@/lib/image/qwenImageModelRouter";
import { secretStore } from "@/lib/secrets/store";
import { configurableProviders } from "@/lib/secrets/types";
import { getAnonymousApiSession } from "@/lib/session/api";

const providerSchema = z.enum(configurableProviders);

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;

  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }

  const provider = providerSchema.safeParse((await context.params).provider);
  if (!provider.success) {
    return NextResponse.json({ error: "未知模型服务。" }, { status: 400 });
  }

  if (isRateLimited(`${session.id}:delete`, 12)) {
    return NextResponse.json({ error: "操作过于频繁，请稍后重试。" }, { status: 429 });
  }

  await secretStore.delete(session.id, provider.data);
  if (provider.data === "qwen-image") clearQwenModelAvailability(session.id);
  return NextResponse.json({ deleted: true });
}
