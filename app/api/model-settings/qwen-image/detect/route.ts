import { NextRequest, NextResponse } from "next/server";

import { inspectQwenImageModels } from "@/lib/image/qwenImageModelRouter";
import { isRateLimited, isSameOrigin } from "@/lib/secrets/security";
import { getAnonymousApiSession } from "@/lib/session/api";

export async function POST(request: NextRequest) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  if (!isSameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  if (isRateLimited(`${sessionResult.session.id}:detect-qwen-models`, 4)) return NextResponse.json({ error: "检测过于频繁，请稍后重试。" }, { status: 429 });
  return NextResponse.json(await inspectQwenImageModels(sessionResult.session.id), { headers: { "cache-control": "no-store" } });
}
