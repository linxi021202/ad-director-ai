import { describe, expect, it } from "vitest";

import { readClientApiResponse } from "../lib/api/clientResponse";

describe("client API response parsing", () => {
  it("turns a plain-text Railway upstream failure into a readable error", async () => {
    const result = await readClientApiResponse(new Response("upstream error", { status: 502 }));
    expect(result).toMatchObject({ success: false, data: null });
    expect(result.error).toContain("生成服务连接暂时中断");
    expect(result.error).not.toContain("Unexpected token");
  });

  it("keeps structured API responses intact", async () => {
    const result = await readClientApiResponse<{ value: number }>(new Response(JSON.stringify({
      success: true,
      data: { value: 3 },
      trace: { provider: "wan" }
    }), { status: 200 }));
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe(3);
    expect(result.trace).toEqual({ provider: "wan" });
  });

  it("never exposes DeepSeek truncation codes from structured API errors", async () => {
    const result = await readClientApiResponse(new Response(JSON.stringify({
      success: false,
      data: null,
      error: "镜头 1：DEEPSEEK_OUTPUT_TRUNCATED：DeepSeek 输出达到长度上限"
    }), { status: 207 }));

    expect(result.success).toBe(false);
    expect(result.error).toBe("生成内容较长，系统已拆分处理。未完成的部分可重新生成。");
    expect(result.error).not.toContain("DEEPSEEK_OUTPUT_TRUNCATED");
  });
});
