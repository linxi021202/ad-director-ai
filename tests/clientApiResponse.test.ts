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
});
