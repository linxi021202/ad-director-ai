vi.mock("server-only", () => ({}));

const sessionMock = vi.hoisted(() => ({
  id: "session-a"
}));

vi.mock("@/lib/session/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session/api")>();
  return {
    ...actual,
    getAnonymousApiSession: vi.fn(async () => ({
      initialized: true,
      session: { id: sessionMock.id, expiresAt: Date.now() + 60_000 }
    }))
  };
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST as saveSettings } from "../app/api/model-settings/route";
import { GET as getSettingsStatus } from "../app/api/model-settings/status/route";
import { DELETE as deleteSetting } from "../app/api/model-settings/[provider]/route";
import { secretStore } from "../lib/secrets/store";
import { isSameOrigin } from "../lib/secrets/security";
import {
  SESSION_INITIALIZATION_FAILED_BODY,
  sessionInitializationFailedResponse
} from "../lib/session/api";

function saveRequest(provider: "deepseek" | "qwen-image", apiKey: string, spoofedSessionId?: string) {
  return new NextRequest("http://localhost/api/model-settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "http://localhost"
    },
    body: JSON.stringify({ provider, apiKey, sessionId: spoofedSessionId })
  });
}

describe("anonymous model settings API isolation", () => {
  afterEach(async () => {
    sessionMock.id = "session-a";
    await secretStore.clear();
  });

  it("isolates two cookie-derived sessions and ignores a spoofed body sessionId", async () => {
    const keyA = "deepseek-session-a-secret-1111";
    const keyB = "deepseek-session-b-secret-2222";

    sessionMock.id = "session-a";
    const saveA = await saveSettings(saveRequest("deepseek", keyA, "session-b"));
    expect(saveA.status).toBe(200);

    sessionMock.id = "session-b";
    expect(await getSettingsStatus().then((response) => response.json())).toMatchObject({
      deepseek: { configured: false, source: "none" }
    });

    const saveB = await saveSettings(saveRequest("deepseek", keyB));
    expect(saveB.status).toBe(200);

    sessionMock.id = "session-a";
    const statusA = await getSettingsStatus().then((response) => response.json());
    expect(statusA.deepseek).toMatchObject({
      configured: true,
      source: "session",
      lastFour: "1111"
    });

    sessionMock.id = "session-b";
    const statusB = await getSettingsStatus().then((response) => response.json());
    expect(statusB.deepseek).toMatchObject({
      configured: true,
      source: "session",
      lastFour: "2222"
    });

    const serialized = JSON.stringify([statusA, statusB]);
    expect(serialized).not.toContain(keyA);
    expect(serialized).not.toContain(keyB);
  });

  it("keeps DeepSeek and Qwen-Image independently isolated", async () => {
    sessionMock.id = "session-a";
    await saveSettings(saveRequest("qwen-image", "dashscope-session-a-secret-3333"));

    sessionMock.id = "session-b";
    const statusB = await getSettingsStatus().then((response) => response.json());
    expect(statusB.qwenImage).toEqual({ configured: false, source: "none" });
  });

  it("deletes only the current session key", async () => {
    await secretStore.set("session-a", "deepseek", "deepseek-session-a-secret-1111");
    await secretStore.set("session-b", "deepseek", "deepseek-session-b-secret-2222");

    sessionMock.id = "session-a";
    const response = await deleteSetting(
      new NextRequest("http://localhost/api/model-settings/deepseek", {
        method: "DELETE",
        headers: { origin: "http://localhost" }
      }),
      { params: Promise.resolve({ provider: "deepseek" }) }
    );
    expect(response.status).toBe(200);

    sessionMock.id = "session-a";
    expect((await getSettingsStatus().then((value) => value.json())).deepseek.configured).toBe(false);
    sessionMock.id = "session-b";
    expect((await getSettingsStatus().then((value) => value.json())).deepseek.lastFour).toBe("2222");
  });

  it("returns the exact UTF-8 session initialization failure contract", async () => {
    const response = sessionInitializationFailedResponse();
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-type")).toContain("charset=utf-8");
    expect(await response.json()).toEqual(SESSION_INITIALIZATION_FAILED_BODY);
  });

  it("accepts the public origin forwarded by Railway and rejects cross-site requests", () => {
    const railwayRequest = new NextRequest("http://internal:8080/api/model-settings", {
      method: "POST",
      headers: {
        host: "internal:8080",
        origin: "https://ad-director-ai-production.up.railway.app",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "ad-director-ai-production.up.railway.app",
        "x-forwarded-proto": "https"
      }
    });
    expect(isSameOrigin(railwayRequest)).toBe(true);

    const crossSiteRequest = new NextRequest("http://internal:8080/api/model-settings", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "x-forwarded-host": "ad-director-ai-production.up.railway.app",
        "x-forwarded-proto": "https"
      }
    });
    expect(isSameOrigin(crossSiteRequest)).toBe(false);
  });
});
