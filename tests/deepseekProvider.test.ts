import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { deepseekProvider } from "../lib/providers/deepseekProvider";

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  process.env.AI_MODE = "real";
  process.env.ENABLE_REAL_TEXT = "true";
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
}

function mockDeepSeekResponse(content: string, finishReason: string | null = null) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: finishReason, message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function requestedChunk(init: RequestInit | undefined, shots: ReturnType<typeof detailedShot>[]) {
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
  const prompt = body.messages.findLast((message) => /本次只生成第/.test(message.content))?.content ?? "";
  const range = prompt.match(/本次只生成第 (\d+)-(\d+) 镜/);
  const first = Number(range?.[1] ?? 1);
  const last = Number(range?.[2] ?? shots.length);
  return shots.slice(first - 1, last);
}

function detailedShot(shot: (typeof coldBrewDemo.shots)[number]) {
  const beats = shot.microBeats?.length ? shot.microBeats : [0, 1].map((index) => ({
    id: `${shot.id}-beat-${index + 1}`, shotId: shot.id, index, purpose: index ? "resolve" as const : "orient" as const,
    startSec: index * shot.durationSec / 2, endSec: (index + 1) * shot.durationSec / 2,
    action: "人物只完成一个清晰可见的小幅动作", stateChange: "人物和产品进入下一个明确状态", complexity: 2
  }));
  return {
    ...shot,
    visualDescription: `${shot.visualDescription}，画面同时明确人物单一动作、真实产品位置、场景光线与前中后景关系。`,
    title: `镜头 ${shot.index} 导演标题`,
    narrativePurpose: "承接前一镜人物与产品状态，通过一个清晰动作引入新的广告信息，并为下一镜建立自然、可执行且连续的动作动机，同时保持观众注意力始终落在当前唯一叙事目标上。",
    commercialPurpose: "建立稳定产品记忆，让核心卖点通过人物行为与产品状态变化得到清晰、可信且可见的证明。",
    previousState: "人物、产品和场景保持上一镜结束时的明确状态。",
    newInformation: "本镜头增加一项清晰可见且与卖点相关的新信息。",
    resultingState: "人物和产品形成可被下一镜直接继承的结束状态。",
    visualSummary: "人物位于画面中部偏左，保持同一脸型、发型、服装和身体比例；真实产品位于桌面中景并保持容器轮廓、包装结构、材质和朝向。前景用少量办公道具建立深度，中景承载人物与产品互动，背景维持同一办公室空间结构。主光从画面右侧窗户进入，阴影方向稳定，摄影机只完成一次克制推近，画面不生成任何可读文字。",
    compositionIntent: "用前中后景、偏心构图和清晰视觉重心，让人物视线自然引导到产品并保留后期文字安全区。",
    emotionalIntent: "呈现克制但清晰的状态变化，避免夸张表演。",
    productVisibilityIntent: "产品保持正面主要颜色区域可见，并占据稳定画面比例。",
    transitionIn: "继承上一镜人物视线和产品位置进入本镜。",
    transitionOut: "以人物手部停点和产品稳定状态连接下一镜。",
    continuityNotes: ["同一人物身份和服装", "同一真实产品结构和朝向", "同一办公室空间和道具", "同一主光方向和综合色调"],
    riskNotes: ["避免复杂手部动作和产品结构变形"],
    containsProduct: true,
    continuityConstraints: ["保持产品身份与包装结构", "保持人物服装和场景空间连续"],
    shotDirection: ["人物只完成一个主要动作", "摄影机只使用一条连续运镜"],
    microBeats: beats.map((beat) => ({ ...beat, characterAction: "人物身体只发生一次清晰的小幅姿态变化", continuityConstraint: "保持同一人物、服装、产品和场景空间关系" }))
  };
}

describe("deepseekProvider", () => {
  beforeEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes Zod validation when DeepSeek returns valid JSON", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(mockDeepSeekResponse(JSON.stringify(coldBrewDemo.strategy))));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStrategy(coldBrewDemo.brief);

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(result.data).toEqual(coldBrewDemo.strategy);
    expect(result.provider).toBe("deepseek");
    expect(result.model).toBe("deepseek-v4-pro");
    expect(result.tokenUsage?.totalTokens).toBe(150);
    expect(result.costEstimate).toContain("estimated CNY");
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an error after invalid JSON fails retry handling", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(mockDeepSeekResponse("```json\nnot-json\n```")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStrategy(coldBrewDemo.brief);

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBe("DeepSeek返回的JSON格式无效。");
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once when Zod validation fails and then returns valid storyboard", async () => {
    const invalidShots = { shots: [{ ...coldBrewDemo.shots[0], recommendedModel: "forbidden-model" }] };
    const validShots = { shots: coldBrewDemo.shots.map((shot) => ({ ...detailedShot(shot), recommendedModel: "qwen-image" })) };
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      callCount += 1;
      return Promise.resolve(callCount === 1
        ? mockDeepSeekResponse(JSON.stringify(invalidShots))
        : mockDeepSeekResponse(JSON.stringify({ shots: requestedChunk(init, validShots.shots) })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStoryboard(coldBrewDemo.brief, coldBrewDemo.strategy);

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(result.data).toHaveLength(8);
    expect(result.data?.every((shot) => shot.recommendedModel === "qwen-image")).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("splits a truncated storyboard chunk, preserves successful parts, and continues", async () => {
    const shots = coldBrewDemo.shots.map((shot) => ({ ...detailedShot(shot), recommendedModel: "qwen-image" }));
    const saved: number[][] = [];
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      callCount += 1;
      return Promise.resolve(callCount === 1
        ? mockDeepSeekResponse('{"shots":[', "length")
        : mockDeepSeekResponse(JSON.stringify({ shots: requestedChunk(init, shots) })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStoryboard(coldBrewDemo.brief, coldBrewDemo.strategy, {
      onStoryboardChunk: async (chunk) => { saved.push(chunk.map((shot) => shot.index)); }
    });

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(result.data).toHaveLength(8);
    expect(saved).toEqual([[1, 2], [3, 4], [5, 6, 7, 8]]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String(call[1]?.body)).max_tokens).toBeLessThanOrEqual(3600);
    }
  });

  it("honors a custom storyboard count and duration plan", async () => {
    const durations = [3, 5, 8];
    const shots = coldBrewDemo.shots.slice(0, 3).map((shot, index) => ({
      ...detailedShot(shot),
      id: `shot-${index + 1}`,
      index: index + 1,
      durationSec: durations[index],
      recommendedModel: "qwen-image"
    }));
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(mockDeepSeekResponse(JSON.stringify({ shots })))));

    const result = await deepseekProvider.generateStoryboard(coldBrewDemo.brief, coldBrewDemo.strategy, {
      requestedShotCount: 3,
      shotDurationPlan: durations
    });

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(result.data?.map((shot) => shot.durationSec)).toEqual(durations);
    expect(result.data?.map((shot) => shot.index)).toEqual([1, 2, 3]);
  });
  it("does not fallback to mock when validation keeps failing", async () => {
    const invalidStrategy = { ...coldBrewDemo.strategy, cta: "" };
    const fetchMock = vi.fn().mockResolvedValue(mockDeepSeekResponse(JSON.stringify(invalidStrategy)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStrategy(coldBrewDemo.brief);

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.provider).toBe("deepseek");
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("scores ad plans with validated DeepSeek json", async () => {
    const score = {
      overallScore: 88,
      dimensionScores: {
        strategyClarity: 18,
        storyboardExecution: 18,
        promptQuality: 18,
        costControl: 17,
        brandSafety: 17
      },
      passed: true,
      summary: "方案清晰，成本可控。",
      risks: ["Hero Shot 需要准备降级方案。"],
      fixSuggestions: ["继续压缩字幕。"],
      modelRouteCheck: {
        allowedOnly: true,
        usedModels: ["deepseek-v4-pro", "qwen-image", "wan2.7-i2v", "remotion"],
        forbiddenModelsFound: []
      },
      videoGenerationStrategyCheck: {
        heroShotOnly: true,
        realVideoShots: 1,
        fallbackReady: true
      }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockDeepSeekResponse(JSON.stringify(score))));

    const result = await deepseekProvider.scoreAdPlan?.(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots);

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ overallScore: 88, passed: true });
    expect(result?.fallbackUsed).toBe(false);
  });
});


