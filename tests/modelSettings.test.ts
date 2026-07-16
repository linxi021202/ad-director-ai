import { afterEach, describe, expect, it, vi } from "vitest";

import { getProviderSecretStatus, resolveProviderApiKey } from "../lib/secrets/resolver";
import { secretStore } from "../lib/secrets/store";

describe("model settings secret resolution", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers the current server session over environment variables", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "environment-secret-value");
    await secretStore.set("session-test", "deepseek", "session-secret-value");
    expect(await resolveProviderApiKey("deepseek", "session-test")).toBe("session-secret-value");
  });

  it("returns public metadata without returning the full key", async () => {
    await secretStore.set("status-test", "qwen-image", "dashscope-secret-A1B2");
    const status = await getProviderSecretStatus("qwen-image", "status-test");
    expect(status).toMatchObject({ configured: true, source: "session", lastFour: "A1B2" });
    expect(JSON.stringify(status)).not.toContain("dashscope-secret");
  });


  it("reuses the Qwen-Image DashScope session key for HappyHorse", async () => {
    await secretStore.set("dashscope-shared", "qwen-image", "dashscope-shared-key-Z9Y8");
    expect(await resolveProviderApiKey("happyhorse", "dashscope-shared")).toBe("dashscope-shared-key-Z9Y8");
    const status = await getProviderSecretStatus("happyhorse", "dashscope-shared");
    expect(status).toMatchObject({ configured: true, source: "session", lastFour: "Z9Y8" });
    expect(JSON.stringify(status)).not.toContain("dashscope-shared-key");
  });
  it("removes session keys immediately", async () => {
    await secretStore.set("delete-test", "happyhorse", "happyhorse-secret-value");
    await secretStore.delete("delete-test", "happyhorse");
    expect(await resolveProviderApiKey("happyhorse", "delete-test")).toBeNull();
  });
});

