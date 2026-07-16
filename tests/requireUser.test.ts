vi.mock("server-only", () => ({}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error("NEXT_REDIRECT:" + url);
  })
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } }
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers())
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

import { getOptionalUser, requirePageUser, requireUser, UnauthorizedError } from "../lib/auth/requireUser";

describe("server user resolution", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.redirect.mockClear();
  });

  it("returns only the minimal authenticated user", async () => {
    mocks.getSession.mockResolvedValue({
      session: { id: "session-id", token: "secret-session-token" },
      user: { id: "user-1", email: "user@example.com", name: "测试用户", image: null }
    });
    await expect(requireUser()).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
      name: "测试用户"
    });
  });

  it("returns null for an anonymous request and throws a unified error when required", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(getOptionalUser()).resolves.toBeNull();
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("redirects protected pages to a safe site-relative callback", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(requirePageUser("/projects/coldbrew-demo-001")).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?callbackUrl=%2Fprojects%2Fcoldbrew-demo-001"
    );
    expect(mocks.redirect).toHaveBeenCalledOnce();
  });
});