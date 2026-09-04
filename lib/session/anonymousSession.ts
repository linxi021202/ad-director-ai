import "server-only";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import { secretStore } from "@/lib/secrets/store";
import {
  ANONYMOUS_SESSION_COOKIE,
  ANONYMOUS_SESSION_MAX_AGE_SECONDS,
  isValidAnonymousSessionId
} from "./anonymousSessionShared";

export type AnonymousSession = {
  id: string;
  createdAt: number;
  expiresAt: number;
};

export type PublicAnonymousSession = Pick<AnonymousSession, "id" | "expiresAt">;

const globalSessionState = globalThis as typeof globalThis & {
  adDirectorAnonymousSessions?: Map<string, AnonymousSession>;
};

const sessions = globalSessionState.adDirectorAnonymousSessions ?? new Map<string, AnonymousSession>();
globalSessionState.adDirectorAnonymousSessions = sessions;

function createSessionRecord(id: string = randomUUID()): AnonymousSession {
  const createdAt = Date.now();
  return {
    id,
    createdAt,
    expiresAt: createdAt + ANONYMOUS_SESSION_MAX_AGE_SECONDS * 1000
  };
}

function publicSession(session: AnonymousSession): PublicAnonymousSession {
  return { id: session.id, expiresAt: session.expiresAt };
}

function registerValidCookieSession(id: string): AnonymousSession {
  const existing = sessions.get(id);
  if (existing && existing.expiresAt > Date.now()) return existing;
  if (existing) sessions.delete(id);
  const session = createSessionRecord(id);
  sessions.set(id, session);
  return session;
}

export async function getAnonymousSession(): Promise<PublicAnonymousSession | null> {
  const value = (await cookies()).get(ANONYMOUS_SESSION_COOKIE)?.value;
  if (!isValidAnonymousSessionId(value)) return null;
  return publicSession(registerValidCookieSession(value));
}

export async function getOrCreateAnonymousSession(): Promise<PublicAnonymousSession> {
  const cookieStore = await cookies();
  const currentValue = cookieStore.get(ANONYMOUS_SESSION_COOKIE)?.value;
  if (isValidAnonymousSessionId(currentValue)) {
    return publicSession(registerValidCookieSession(currentValue));
  }

  const session = createSessionRecord();
  sessions.set(session.id, session);
  cookieStore.set(ANONYMOUS_SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ANONYMOUS_SESSION_MAX_AGE_SECONDS
  });
  return publicSession(session);
}

export async function requireAnonymousSession(): Promise<PublicAnonymousSession> {
  return getOrCreateAnonymousSession();
}

export async function clearAnonymousSession(): Promise<void> {
  const cookieStore = await cookies();
  const value = cookieStore.get(ANONYMOUS_SESSION_COOKIE)?.value;
  if (isValidAnonymousSessionId(value)) {
    sessions.delete(value);
    await secretStore.deleteSession(value);
  }
  cookieStore.delete(ANONYMOUS_SESSION_COOKIE);
}

export function resetAnonymousSessionsForTests(): void {
  sessions.clear();
}
