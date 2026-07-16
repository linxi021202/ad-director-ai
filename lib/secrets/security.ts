import type { NextRequest } from "next/server";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function isSameOrigin(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

export function isRateLimited(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

export function isPlausibleApiKey(value: string) {
  return value.length >= 16 && value.length <= 512 && !/\s/.test(value);
}
