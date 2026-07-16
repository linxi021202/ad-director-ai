vi.mock("server-only", () => ({}));

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    readonly code = "UNAUTHORIZED";
  }
  return {
    requireUser: vi.fn(),
    UnauthorizedError
  };
});

vi.mock("@/lib/auth/requireUser", () => ({
  requireUser: authMocks.requireUser,
  UnauthorizedError: authMocks.UnauthorizedError
}));

import { requireApiUser, UNAUTHORIZED_API_BODY } from "../lib/auth/api";
import { safeCallbackUrl } from "../lib/auth/callback-url";
import { signInSchema, signUpSchema } from "../lib/auth/validation";

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) return routeFiles(file);
    return name === "route.ts" ? [file] : [];
  });
}

describe("stage 1A authentication foundation", () => {
  it("validates sign-up and sign-in input without exposing provider internals", () => {
    expect(signInSchema.safeParse({ email: "user@example.com", password: "password-123" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "bad", password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({
      name: "测试用户",
      email: "user@example.com",
      password: "password-123",
      confirmPassword: "different"
    }).success).toBe(false);
  });

  it("only accepts site-relative callback URLs", () => {
    expect(safeCallbackUrl("/generate")).toBe("/generate");
    expect(safeCallbackUrl("/projects/coldbrew-demo-001?tab=shots")).toContain("/projects/");
    expect(safeCallbackUrl("https://evil.example/steal")).toBe("/dashboard");
    expect(safeCallbackUrl("//evil.example/steal")).toBe("/dashboard");
    expect(safeCallbackUrl("/\\evil.example")).toBe("/dashboard");
  });

  it("returns the exact JSON 401 contract when no session exists", async () => {
    authMocks.requireUser.mockRejectedValueOnce(new authMocks.UnauthorizedError());
    const result = await requireApiUser();
    expect(result.authenticated).toBe(false);
    if (result.authenticated) throw new Error("expected anonymous result");
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual(UNAUTHORIZED_API_BODY);
    expect(result.response.headers.get("content-type")).toContain("application/json");
  });

  it("protects every business Route Handler before request processing", () => {
    const files = routeFiles("app/api").filter((file) => !file.includes(path.join("api", "auth")));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const methodCount = (source.match(/export async function (GET|POST|DELETE)\(/g) ?? []).length;
      const guardCount = (source.match(/const authResult = await requireApiUser\(\);/g) ?? []).length;
      expect(guardCount, file).toBe(methodCount);
      expect(source, file).toContain('if (!authResult.authenticated) return authResult.response;');
    }
  });

  it("protects all business pages with a server-side session check", () => {
    const pages = [
      "app/dashboard/page.tsx",
      "app/generate/page.tsx",
      "app/projects/page.tsx",
      "app/projects/[id]/page.tsx",
      "app/settings/page.tsx",
      "app/font-diagnostic/page.tsx"
    ];
    for (const page of pages) {
      expect(readFileSync(page, "utf8"), page).toContain("requirePageUser(");
    }
  });

  it("keeps the public demo static and non-consuming", () => {
    const source = readFileSync("app/demo/page.tsx", "utf8");
    expect(source).not.toContain("redirect(");
    expect(source).not.toContain("/api/");
    expect(source).not.toContain("GenerateWorkflow");
    expect(source).toContain("不调用真实模型");
  });

  it("uses Better Auth with the Prisma PostgreSQL adapter and database sessions", () => {
    const authSource = readFileSync("lib/auth.ts", "utf8");
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(authSource).toContain("betterAuth({");
    expect(authSource).toContain("prismaAdapter(getPrisma()");
    expect(authSource).toContain('provider: "postgresql"');
    expect(authSource).toContain("emailAndPassword");
    expect(schema).toContain("model User");
    expect(schema).toContain("model Session");
    expect(schema).toContain("model Account");
    expect(schema).toContain("model Verification");
    expect(schema).not.toMatch(/model (Project|Asset|Job|ProviderCredential)/);
  });

  it("does not expose server secrets through client source files", () => {
    const clientFiles = [
      "app/page.tsx",
      "components/auth/AuthForm.tsx",
      "components/auth/UserMenu.tsx",
      "components/ModelSettingsSheet.tsx",
      "lib/auth-client.ts"
    ];
    const clientSource = clientFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(clientSource).not.toContain("BETTER_AUTH_SECRET");
    expect(clientSource).not.toContain("DATABASE_URL");
    expect(clientSource).not.toMatch(/NEXT_PUBLIC_(DEEPSEEK|DASHSCOPE|HAPPYHORSE|BETTER_AUTH)/);
  });

  it("indexes transitional model secrets by the authenticated user id", () => {
    const settingsRoute = readFileSync("app/api/model-settings/route.ts", "utf8");
    const store = readFileSync("lib/secrets/store.ts", "utf8");
    expect(settingsRoute).toContain("authResult.user.id");
    expect(settingsRoute).not.toContain("MODEL_SESSION_COOKIE");
    expect(store).toContain("TEMPORARY_IN_MEMORY_BY_USER_ID");
  });
});