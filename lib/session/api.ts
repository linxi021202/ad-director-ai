import "server-only";

import { NextResponse } from "next/server";

import { requireAnonymousSession, type PublicAnonymousSession } from "./anonymousSession";

export const SESSION_INITIALIZATION_FAILED_BODY = {
  error: {
    code: "SESSION_INITIALIZATION_FAILED",
    message: "无法初始化临时会话，请刷新页面后重试。"
  }
} as const;

export function sessionInitializationFailedResponse() {
  return NextResponse.json(SESSION_INITIALIZATION_FAILED_BODY, {
    status: 500,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function getAnonymousApiSession(): Promise<
  | { initialized: true; session: PublicAnonymousSession }
  | { initialized: false; response: NextResponse }
> {
  try {
    return { initialized: true, session: await requireAnonymousSession() };
  } catch {
    return { initialized: false, response: sessionInitializationFailedResponse() };
  }
}
