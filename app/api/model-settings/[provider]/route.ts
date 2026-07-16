import { requireApiUser } from "@/lib/auth/api";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isRateLimited, isSameOrigin } from "@/lib/secrets/security";
import { secretStore } from "@/lib/secrets/store";
import { configurableProviders } from "@/lib/secrets/types";

const providerSchema = z.enum(configurableProviders);

export async function DELETE(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const provider = providerSchema.safeParse((await context.params).provider);
  if (!provider.success) return NextResponse.json({ error: "未知模型服务。" }, { status: 400 });
  const ownerId = authResult.user.id;
  if (isRateLimited(`${ownerId}:delete`, 12)) return NextResponse.json({ error: "操作过于频繁，请稍后重试。" }, { status: 429 });
  await secretStore.delete(ownerId, provider.data);
  return NextResponse.json({ deleted: true });
}
