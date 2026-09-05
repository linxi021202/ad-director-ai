import type { NextRequest } from "next/server";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function isSameOrigin(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const allowedOrigins = new Set([normalizeOrigin(request.nextUrl.origin)]);
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const requestHost = firstForwardedValue(request.headers.get("host"));
  const host = forwardedHost || requestHost;
  const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "");

  if (host && (protocol === "http" || protocol === "https")) {
    allowedOrigins.add(normalizeOrigin(`${protocol}://${host}`));
  }

  return allowedOrigins.has(normalizeOrigin(origin));
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
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
