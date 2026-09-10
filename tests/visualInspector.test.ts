import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../lib/secrets/resolver", () => ({
  resolveProviderApiKey: vi.fn(async () => "dashscope-session-key")
}));

import { callVisualInspector, buildInspectorUrl } from "../lib/visual/visualInspector";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("qwen3.7-plus visual inspector adapter", () => {
  it("builds the official OpenAI-compatible chat endpoint from a DashScope root", () => {
    expect(buildInspectorUrl("https://dashscope.aliyuncs.com"))
      .toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  });

  it("keeps a preconfigured compatible-mode endpoint", () => {
    expect(buildInspectorUrl("https://dashscope.aliyuncs.com/compatible-mode/v1"))
      .toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  });

  it("uses qwen3.7-plus and structured JSON without exposing the key in the body", async () => {
    vi.stubEnv("VISUAL_INSPECTOR_MODEL", "qwen3.7-plus");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
      request_id: "req-inspector-1",
      choices: [{ message: { content: '{"passed":true}' } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callVisualInspector({
      sessionId: "session-one",
      images: ["data:image/png;base64,aW1hZ2U="],
      prompt: "Inspect this image.",
      schema: z.object({ passed: z.boolean() }).strict()
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ passed: true });
    expect(result.model).toBe("qwen3.7-plus");
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("qwen3.7-plus");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,aW1hZ2U=" }
    });
    expect(String(init?.body)).not.toContain("dashscope-session-key");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer dashscope-session-key");
  });

  it("supports direct video inspection input", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"passed":false}' } }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await callVisualInspector({
      sessionId: "session-one",
      videoUrl: "https://example.test/shot.mp4",
      prompt: "Inspect this video.",
      schema: z.object({ passed: z.boolean() }).strict()
    });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(body.messages[1].content[0]).toEqual({
      type: "video_url",
      video_url: { url: "https://example.test/shot.mp4" }
    });
  });

  it("fails closed on schema-invalid model output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"wrong":true}' } }]
    }), { status: 200 })));
    const result = await callVisualInspector({
      sessionId: "session-one",
      images: ["data:image/png;base64,aW1hZ2U="],
      prompt: "Inspect.",
      schema: z.object({ passed: z.boolean() }).strict()
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("VISUAL_INSPECTOR_SCHEMA_ERROR");
  });
});
