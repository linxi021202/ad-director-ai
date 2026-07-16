import "server-only";

import { NextResponse } from "next/server";

import {
  requireUser,
  UnauthorizedError,
  type AuthenticatedUser
} from "@/lib/auth/requireUser";

export const UNAUTHORIZED_API_BODY = {
  error: {
    code: "UNAUTHORIZED",
    message: "请先登录后继续。"
  }
} as const;

export function unauthorizedApiResponse() {
  return NextResponse.json(UNAUTHORIZED_API_BODY, {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

/**
 * Authentication gate only. Project ownership is intentionally deferred:
 * AUTHENTICATED_BUT_NOT_YET_OWNERSHIP_SCOPED.
 */
export async function requireApiUser(): Promise<
  | { authenticated: true; user: AuthenticatedUser }
  | { authenticated: false; response: NextResponse }
> {
  try {
    return { authenticated: true, user: await requireUser() };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { authenticated: false, response: unauthorizedApiResponse() };
    }
    throw error;
  }
}