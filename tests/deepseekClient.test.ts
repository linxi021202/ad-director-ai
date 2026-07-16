import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callDeepSeekLLM } from "../lib/llm/deepseekClient";

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  process.env.AI_MODE = "real";
  process.env.ENABLE_REAL_TEXT = "true";
  process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
  process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
}

function mockResponse(content: string | null, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

describe("deepseekClient", () => {
  beforeEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls DeepSeek chat completions with json response_format", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeekLLM({
      messages: [{ role: "user", content: "Return json with ok=true" }],
      responseFormat: "json",
      temperature: 0.2,
      maxTokens: 128
    });

    expect(result.success).toBe(true);
    expect(result.json).toEqual({ ok: true });
    expect(result.provider).toBe("deepseek");
    expect(result.model).toBe("deepseek-v4-flash");
    expect(result.tokenUsage?.totalTokens).toBe(20);
    expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.com/chat/completions", expect.objectContaining({ method: "POST" }));

    const [, request] = fetchMock.mock.calls[0];
    expect(request.headers.Authorization).toBe("Bearer test-deepseek-key");
    expect(JSON.parse(request.body)).toMatchObject({
      model: "deepseek-v4-flash",
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 128
    });
  });

  it("parses json after removing markdown code fences", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse("```json\n{\"ok\":true}\n```")));

    const result = await callDeepSeekLLM({
      messages: [{ role: "user", content: "Return json" }],
      responseFormat: "json"
    });

    expect(result.success).toBe(true);
    expect(result.json).toEqual({ ok: true });
  });

  it("returns success=false when content is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse("")));

    const result = await callDeepSeekLLM({
      messages: [{ role: "user", content: "Return text" }],
      responseFormat: "text"
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("DeepSeek调用失败，请检查密钥、额度或服务状态。");
  });

  it("does not throw uncaught fetch errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await callDeepSeekLLM({
      messages: [{ role: "user", content: "Return text" }],
      responseFormat: "text"
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("DeepSeek调用失败，请检查密钥、额度或服务状态。");
  });
});
