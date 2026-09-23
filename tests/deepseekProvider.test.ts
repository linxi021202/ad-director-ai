import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { deepseekProvider, expandShotPrompts } from "../lib/providers/deepseekProvider";
import { ensureShotArchitecture } from "../lib/storyboard/shotArchitecture";

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

function promptFoundation(shotId: string, durationSec: number) {
  const english = "A precise commercial direction with stable product identity, character continuity, executable camera placement, controlled lighting, material detail, and spatial depth. ".repeat(3);
  return {
    shotId,
    continuityContext: {
      product: "同一真实产品的容器轮廓、包装结构和颜色区域",
      character: "同一人物的脸型、发型、年龄感和身体比例",
      wardrobe: "同一套已确认服装与配饰",
      scene: "同一办公室空间、窗户、桌面和摄影轴线",
      sceneState: "人物和产品延续上一镜结束状态",
      majorProps: ["桌面", "显示器"],
      previousShotState: "人物与产品均处于上一镜结束位置",
      immutableElements: ["产品结构不变", "人物身份不变", "场景结构不变"],
      allowedChanges: ["视线和轻微姿态可以变化"]
    },
    directingNotesCn: "机位保持人物视线高度，使用标准焦段；前景桌角建立空间，中景安排人物与产品，背景保留窗户和显示器。主光从右侧进入，辅光控制阴影，材质、产品位置、手部状态和摄影机运动都必须具体可执行。".repeat(2),
    directingNotesEn: english,
    videoPromptCn: `开始状态 Start State：人物和产品保持稳定。0.0s-${(durationSec / 2).toFixed(1)}s 人物只改变视线，双手和产品不动；${(durationSec / 2).toFixed(1)}s-${durationSec.toFixed(1)}s 摄影机沿单一路径轻微推近，人物右手缓慢靠近产品后停止。结束状态 End State：产品位置、比例、结构、材质和包装均不改变，人物身份、服装、场景结构与光线方向连续，禁止切镜、拼贴、新增人物、手部畸形、容器变化和任何可读文字。`.repeat(2),
    videoPromptEn: english,
    negativePromptCn: "禁止任何可读文字、乱码、水印、拼贴、分屏、重复主体、手部畸形、额外手指、额外肢体、人物身份变化、场景结构变化、产品容器变化、包装比例变化和材质颜色变化。",
    negativePromptEn: "No readable text, gibberish, watermark, collage, split screen, duplicate subject, deformed hands, extra fingers, or product changes.",
    narrationDirection: "旁白克制简短",
    textSafeZone: "top-center",
    qaChecklist: ["保持单一完整画面", "产品结构保持不变", "人物身份保持不变", "场景空间保持连续", "动作能够真实执行", "画面禁止可读文字"],
    qualityScores: { creativeDepth: 9, visualSpecificity: 9, productConsistency: 9, characterContinuity: 9, sceneContinuity: 9, actionExecutability: 9, textRisk: 1, deformationRisk: 2 }
  };
}

function expandedFrame(frame: NonNullable<ReturnType<typeof ensureShotArchitecture>["frames"]>[number]) {
  const cn = `${"单一完整商业摄影画面，只呈现一个确定冻结瞬间。人物位于画面左侧，双手状态清楚，视线看向中景真实产品；产品包装正面、容器轮廓、比例、颜色区域与材质严格保持。前景桌角建立深度，中景承载人物和产品，背景办公室窗户与显示器保持稳定。机位位于人物视线高度，标准焦段，景深克制，主光从右侧进入，辅光压低阴影，反射不遮挡产品。".repeat(3)}画面不得出现任何可读文字。这是一张单一完整摄影画面，只描述一个确定时间点。`;
  const en = "One complete frozen commercial frame with a stable subject, exact product identity, clear hand state, controlled foreground, middle ground and background, eye-level camera, standard lens, shallow depth of field, directional key light, restrained fill light, accurate materials, no readable text, no collage, and no split screen. ".repeat(3);
  return {
    frameId: frame.id, timestampSec: frame.timestampSec, role: frame.role,
    frozenMoment: "人物视线刚落到产品上且双手保持稳定的确定瞬间",
    subject: "同一位已确认人物与真实产品", subjectPosition: "人物左侧，产品右侧中景", characterPose: "坐姿微前倾且肩膀放松",
    facialExpression: "克制专注的表情", gazeDirection: "视线明确看向产品", handState: "双手完整可见且保持自然",
    productPosition: "产品位于桌面右侧中景", productOrientation: "包装正面朝向摄影机", productScale: "占画面高度约八分之一",
    environment: "同一办公室空间与桌面陈设", foreground: "虚化桌角与文件", middleGround: "人物双手和真实产品", background: "窗户、显示器和座椅",
    composition: "偏心三分构图并保留顶部安全区", cameraHeight: "人物视线高度", cameraAngle: "轻微侧前方", lens: "标准镜头", focalLength: "50mm", aperture: "f/2.8",
    depthOfField: "主体清晰且背景轻微虚化", lightingDirection: "从右侧窗户指向左侧", lightingQuality: "柔和而有方向的主光", keyLight: "右侧窗户柔光", fillLight: "左前方低强度补光",
    practicalLights: "背景显示器冷色环境光", shadowBehavior: "阴影向左后方自然衰减", reflections: "产品反射受控且不遮挡包装", materialDetails: "产品、杯盖和服装织物纹理清晰",
    colorDesign: "冷灰环境配真实包装主色", atmosphere: "安静克制且保持专注的办公氛围", spatialDepth: "前中后景清晰分层",
    continuityConstraints: ["产品结构不变", "人物身份不变", "场景空间不变"], forbiddenChanges: ["禁止新增文字", "禁止改变容器", "禁止新增人物"],
    imagePromptCn: cn, imagePromptEn: en,
    negativePromptCn: "禁止任何可读文字、乱码、水印、拼贴、分屏、重复主体、手部畸形、额外手指和产品容器变化。",
    negativePromptEn: "No readable text, gibberish, watermark, collage, split screen, deformed hands, extra fingers, or changed product container."
  };
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

  it("repairs only the drifting shot when an unknown character state field is returned", async () => {
    const validShots = { shots: coldBrewDemo.shots.map((shot) => ({ ...detailedShot(shot), recommendedModel: "qwen-image" })) };
    const driftingFirstChunk = structuredClone(validShots.shots.slice(0, 2));
    driftingFirstChunk[0]!.sceneStateAfter = {
      shotId: driftingFirstChunk[0]!.id,
      characterStates: [{
        characterId: "character-main", position: "桌边", pose: "坐姿", gaze: "产品", expression: "眉眼放松",
        emotion: "疲惫但开始恢复", energyLevel: "逐步提升", handState: "右手靠近产品",
        completelyInventedField: "不允许"
      }],
      productStates: [], propStates: []
    } as never;
    const repairs: Array<{ shotIndex: number; unknownFields: string[] }> = [];
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      callCount += 1;
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const repairing = body.messages.some((message) => message.content.includes("待修复镜头"));
      if (repairing) return Promise.resolve(mockDeepSeekResponse(JSON.stringify({ shot: validShots.shots[0] })));
      return Promise.resolve(callCount === 1
        ? mockDeepSeekResponse(JSON.stringify({ shots: driftingFirstChunk }))
        : mockDeepSeekResponse(JSON.stringify({ shots: requestedChunk(init, validShots.shots) })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStoryboard(coldBrewDemo.brief, coldBrewDemo.strategy, {
      onStoryboardRepair: async ({ shotIndex, unknownFields }) => { repairs.push({ shotIndex, unknownFields }); }
    });

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(result.data).toHaveLength(8);
    expect(result.data?.every((shot) => shot.recommendedModel === "qwen-image")).toBe(true);
    expect(repairs).toEqual([{ shotIndex: 1, unknownFields: ["completelyInventedField"] }]);
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(5);
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
    expect(saved).toEqual([[1], [2], [3, 4], [5, 6], [7, 8]]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String(call[1]?.body)).max_tokens).toBeLessThanOrEqual(3600);
    }
  });

  it("continues from persisted storyboard chunks instead of regenerating completed shots", async () => {
    const shots = coldBrewDemo.shots.map((shot) => ({ ...detailedShot(shot), recommendedModel: "qwen-image" }));
    const saved: number[][] = [];
    const fetchMock = vi.fn().mockImplementation((_url, init) => Promise.resolve(
      mockDeepSeekResponse(JSON.stringify({ shots: requestedChunk(init, shots) }))
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStoryboard(coldBrewDemo.brief, coldBrewDemo.strategy, {
      resumeStoryboardShots: shots.slice(0, 4),
      onStoryboardChunk: async (chunk) => { saved.push(chunk.map((shot) => shot.index)); }
    });

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(result.data).toHaveLength(8);
    expect(saved).toEqual([[5, 6], [7, 8]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { messages: Array<{ content: string }> };
    expect(requestBody.messages.some((message) => message.content.includes("本次只生成第 5-6 镜"))).toBe(true);
  });

  it("splits a schema-drifting chunk and saves valid single shots for resume", async () => {
    const shots = coldBrewDemo.shots.map((shot) => ({ ...detailedShot(shot), recommendedModel: "qwen-image" }));
    const saved: number[][] = [];
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      calls += 1;
      const chunk = requestedChunk(init, shots);
      return Promise.resolve(mockDeepSeekResponse(JSON.stringify({ shots: calls === 1 ? chunk.slice(0, 1) : calls === 2 ? [] : chunk })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStoryboard(coldBrewDemo.brief, coldBrewDemo.strategy, {
      onStoryboardChunk: async (chunk) => { saved.push(chunk.map((shot) => shot.index)); }
    });

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(saved).toEqual([[1], [2], [3, 4], [5, 6], [7, 8]]);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    const retryBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as { messages: Array<{ content: string }> };
    expect(retryBody.messages.some((message) => message.content.includes("上次单镜头结构校验未通过"))).toBe(true);
  });

  it("accepts a single-shot envelope and uses planned indices and durations", async () => {
    const shots = coldBrewDemo.shots.map((shot) => ({ ...detailedShot(shot), recommendedModel: "qwen-image" }));
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init) => {
      calls += 1;
      const chunk = requestedChunk(init, shots);
      if (calls === 1) return Promise.resolve(mockDeepSeekResponse(JSON.stringify({ shots: chunk.slice(0, 1) })));
      if (calls === 2) {
        const { index: _index, durationSec: _duration, ...shot } = chunk[0]!;
        return Promise.resolve(mockDeepSeekResponse(JSON.stringify({ shot })));
      }
      if (calls === 3) return Promise.resolve(mockDeepSeekResponse(JSON.stringify({ ...chunk[0], index: 99, durationSec: 8 })));
      return Promise.resolve(mockDeepSeekResponse(JSON.stringify({ shots: chunk })));
    }));

    const result = await deepseekProvider.generateStoryboard(coldBrewDemo.brief, coldBrewDemo.strategy);

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(result.data?.map((shot) => shot.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.data?.map((shot) => shot.durationSec)).toEqual(Array(8).fill(5));
  });

  it("splits a detailed prompt package into a foundation and per-frame requests with compact truncation recovery", async () => {
    const shot = ensureShotArchitecture(coldBrewDemo.shots[0]!);
    const frames = shot.frames ?? [];
    let foundationAttempts = 0;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }>; max_tokens: number };
      const prompt = body.messages.findLast((message) => message.role !== "system")?.content ?? "";
      if (prompt.includes("导演基础包") && !prompt.includes("关键帧提示词工程师")) {
        foundationAttempts += 1;
        return Promise.resolve(foundationAttempts === 1
          ? mockDeepSeekResponse('{"shotId":', "length")
          : mockDeepSeekResponse(JSON.stringify(promptFoundation(shot.id, shot.durationSec))));
      }
      const frame = frames.find((item) => prompt.includes(item.id));
      if (!frame) throw new Error("未找到当前帧");
      return Promise.resolve(mockDeepSeekResponse(JSON.stringify(expandedFrame(frame))));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await expandShotPrompts({ brief: coldBrewDemo.brief, strategy: coldBrewDemo.strategy, shot });

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(result.data?.framePrompts).toHaveLength(frames.length);
    expect(foundationAttempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(frames.length + 2);
    const requestBodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as { max_tokens: number; messages: Array<{ content: string }> });
    expect(requestBodies.every((body) => body.max_tokens <= 3200)).toBe(true);
    expect(requestBodies.some((body) => body.messages.some((message) => message.content.includes("长度保护重试")))).toBe(true);
  });

  it("resumes a detailed prompt package from its saved foundation and completed frames", async () => {
    const shot = ensureShotArchitecture(coldBrewDemo.shots[0]!);
    const frames = shot.frames ?? [];
    const savedFrames = [expandedFrame(frames[0]!)];
    const persistedFrameIds: string[] = [];
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      const prompt = body.messages.findLast((message) => message.role !== "system")?.content ?? "";
      expect(prompt).not.toContain("只生成镜头 1 的导演基础包");
      expect(prompt).not.toContain(frames[0]!.id);
      const frame = frames.slice(1).find((item) => prompt.includes(item.id));
      if (!frame) throw new Error("未找到待续写帧");
      return Promise.resolve(mockDeepSeekResponse(JSON.stringify(expandedFrame(frame))));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await expandShotPrompts(
      { brief: coldBrewDemo.brief, strategy: coldBrewDemo.strategy, shot },
      {
        resumeShotPromptDraft: {
          shotId: shot.id,
          schemaVersion: 2,
          inputFingerprint: "a".repeat(64),
          foundation: promptFoundation(shot.id, shot.durationSec),
          framePrompts: savedFrames
        },
        onShotPromptFrame: async (frame) => { persistedFrameIds.push(frame.frameId); }
      }
    );

    expect(result.success, result.error ?? undefined).toBe(true);
    expect(result.data?.framePrompts).toHaveLength(frames.length);
    expect(fetchMock).toHaveBeenCalledTimes(Math.max(0, frames.length - 1));
    expect(persistedFrameIds).toEqual(frames.slice(1).map((frame) => frame.id));
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
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init) => Promise.resolve(mockDeepSeekResponse(JSON.stringify({ shots: requestedChunk(init, shots) })))));

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


