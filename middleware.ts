import { NextRequest, NextResponse } from "next/server";

import {
  ANONYMOUS_SESSION_COOKIE,
  ANONYMOUS_SESSION_MAX_AGE_SECONDS,
  isValidAnonymousSessionId
} from "@/lib/session/anonymousSessionShared";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const current = request.cookies.get(ANONYMOUS_SESSION_COOKIE)?.value;

  if (!isValidAnonymousSessionId(current)) {
    response.cookies.set(ANONYMOUS_SESSION_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ANONYMOUS_SESSION_MAX_AGE_SECONDS
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
