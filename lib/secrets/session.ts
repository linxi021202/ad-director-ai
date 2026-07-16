import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";

export const MODEL_SESSION_COOKIE = "ad_director_model_session";

export function createModelSessionId() {
  return randomUUID();
}

export function attachModelSessionCookie(response: NextResponse, sessionId: string) {
  response.cookies.set(MODEL_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}
