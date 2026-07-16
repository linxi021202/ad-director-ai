import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("Better Auth PostgreSQL integration", () => {
  it("registers, signs in, rejects a wrong password, and signs out", async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-at-least-32-characters";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";

    const { auth } = await import("../lib/auth");
    const email = "auth-" + randomUUID() + "@example.com";
    const password = "test-password-123";

    const signUp = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "数据库测试用户", email, password })
    }));
    expect(signUp.ok).toBe(true);

    const wrongPassword = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "wrong-password" })
    }));
    expect(wrongPassword.ok).toBe(false);

    const signIn = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    }));
    expect(signIn.ok).toBe(true);
    const cookie = signIn.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const signOut = await auth.handler(new Request("http://localhost:3000/api/auth/sign-out", {
      method: "POST",
      headers: cookie ? { cookie } : undefined
    }));
    expect(signOut.ok).toBe(true);
  });
});