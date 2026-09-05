import "server-only";

import { NextResponse } from "next/server";

import { getAnonymousApiSession } from "@/lib/session/api";
import { listSessionVideoLibrary } from "@/lib/video/videoLibrary";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;

  const videos = await listSessionVideoLibrary(sessionResult.session.id);
  return NextResponse.json(
    { success: true, data: { videos }, error: null },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
