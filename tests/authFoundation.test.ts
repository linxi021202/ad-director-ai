vi.mock("server-only", () => ({}));

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import {
  ANONYMOUS_SESSION_COOKIE,
  ANONYMOUS_SESSION_MAX_AGE_SECONDS,
  isValidAnonymousSessionId
} from "../lib/session/anonymousSessionShared";

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) return routeFiles(file);
    return name === "route.ts" ? [file] : [];
  });
}

describe("anonymous session foundation", () => {
  it("creates a secure HttpOnly anonymous cookie", () => {
    const response = middleware(new NextRequest("http://localhost/generate"));
    const cookie = response.cookies.get(ANONYMOUS_SESSION_COOKIE);
    const setCookie = response.headers.get("set-cookie") || "";

    expect(cookie).toBeDefined();
    expect(isValidAnonymousSessionId(cookie?.value)).toBe(true);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=" + ANONYMOUS_SESSION_MAX_AGE_SECONDS);
  });

  it("replaces an invalid cookie and keeps a valid cookie stable", () => {
    const invalid = new NextRequest("http://localhost/generate", {
      headers: { cookie: ANONYMOUS_SESSION_COOKIE + "=../../invalid" }
    });
    const replacement = middleware(invalid).cookies.get(ANONYMOUS_SESSION_COOKIE)?.value;
    expect(isValidAnonymousSessionId(replacement)).toBe(true);

    const validId = crypto.randomUUID();
    const valid = new NextRequest("http://localhost/generate", {
      headers: { cookie: ANONYMOUS_SESSION_COOKIE + "=" + validId }
    });
    expect(middleware(valid).cookies.get(ANONYMOUS_SESSION_COOKIE)).toBeUndefined();
  });

  it("initializes anonymous identity before every business Route Handler", () => {
    const files = routeFiles("app/api").filter((file) =>
      !file.includes(path.join("api", "auth")) &&
      !file.includes(path.join("api", "internal")) &&
      !file.includes(path.join("api", "health"))
    );
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const methodCount = (source.match(/export async function/g) || []).length;
      const guardCount = (source.match(/const sessionResult = await getAnonymousApiSession/g) || []).length;
      const sharedHandlerDelegations = (source.match(/return handle\(request, context\)/g) || []).length;
      const guardedDirectly = guardCount === methodCount;
      const guardedBySharedHandler = guardCount === 1 && sharedHandlerDelegations === methodCount;
      expect(guardedDirectly || guardedBySharedHandler, file).toBe(true);
      expect(source, file).not.toContain("requireApiUser");
      expect(source, file).not.toContain("authResult.user.id");
    }
  });

  it("keeps all product pages publicly accessible", () => {
    const pages = [
      "app/page.tsx",
      "app/generate/page.tsx",
      "app/projects/page.tsx",
      "app/projects/[id]/page.tsx",
      "app/settings/page.tsx",
      "app/font-diagnostic/page.tsx",
      "app/demo/page.tsx"
    ];
    for (const page of pages) {
      expect(readFileSync(page, "utf8"), page).not.toContain("requirePageUser(");
    }
  });

  it("removes account controls from the formal navigation", () => {
    const navigation = [
      readFileSync("app/page.tsx", "utf8"),
      readFileSync("components/workspace/WorkspaceHeader.tsx", "utf8")
    ].join("\n");
    expect(navigation).not.toContain("UserMenu");
    expect(navigation).not.toContain("/sign-in");
    expect(navigation).not.toContain("/sign-up");
    expect(navigation).not.toContain("/dashboard");
  });

  it("indexes secrets by anonymous session and does not persist keys in browser storage", () => {
    const store = readFileSync("lib/secrets/store.ts", "utf8");
    const sheet = readFileSync("components/ModelSettingsSheet.tsx", "utf8");
    expect(store).toContain("TEMPORARY_IN_MEMORY_BY_ANONYMOUS_SESSION");
    expect(store).toContain("Map<string, SessionSecrets>");
    expect(sheet).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(sheet).not.toMatch(/NEXT_PUBLIC_(DEEPSEEK|DASHSCOPE|HAPPYHORSE)/);
  });

  it("does not require database configuration in the anonymous runtime path", () => {
    const runtime = [
      readFileSync("app/page.tsx", "utf8"),
      readFileSync("app/generate/page.tsx", "utf8"),
      readFileSync("app/projects/[id]/page.tsx", "utf8"),
      readFileSync("components/GenerateWorkflow.tsx", "utf8"),
      readFileSync("lib/session/anonymousSession.ts", "utf8")
    ].join("\n");
    expect(runtime).not.toContain("@/lib/db");
    expect(runtime).not.toContain("@/lib/auth");
    expect(runtime).not.toContain("DATABASE_URL");
    expect(runtime).not.toContain("BETTER_AUTH_SECRET");
  });
});