import { requireApiUser } from "@/lib/auth/api";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getProviderSecretStatus } from "@/lib/secrets/resolver";
import { isPlausibleApiKey, isRateLimited, isSameOrigin } from "@/lib/secrets/security";
import { secretStore } from "@/lib/secrets/store";
import { configurableProviders } from "@/lib/secrets/types";

const bodySchema = z.object({ provider: z.enum(configurableProviders), apiKey: z.string() });

export async function POST(request: NextRequest) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isPlausibleApiKey(parsed.data.apiKey.trim())) {
    return NextResponse.json({ error: "密钥格式无效。" }, { status: 400 });
  }

  const ownerId = authResult.user.id;
  if (isRateLimited(`${ownerId}:save`, 12)) return NextResponse.json({ error: "操作过于频繁，请稍后重试。" }, { status: 429 });

  await secretStore.set(ownerId, parsed.data.provider, parsed.data.apiKey.trim());
  const status = await getProviderSecretStatus(parsed.data.provider, ownerId);
  return NextResponse.json({ provider: parsed.data.provider, status });
}
