import { generationProjectSchema } from "../schemas/project";
import { appendNoReadableTextRules } from "../prompts/noReadableText";

export const coldBrewDemo = generationProjectSchema.parse({
  id: "coldbrew-demo-001",
  brief: {
    productName: "低糖冷萃咖啡",
    category: "即饮咖啡",
    sellingPoints: [
      "低糖轻负担，适合工作日高频饮用",
      "冷萃工艺带来顺滑口感和清爽冰感",
      "通勤、会议前、下午低电量场景都能快速补能"
    ],
    targetAudience: "一线城市上班族",
    platform: "douyin",
    style: "小红书/抖音竖版广告，深色科技感，城市通勤，高级清爽，适合AI产品Demo展示",
    aspectRatio: "9:16",
    durationSec: 28
  },
  strategy: {
    audienceInsight: "一线城市上班族每天在通勤、会议和深度工作之间切换，需要快速恢复清醒，同时希望饮品不要带来高糖负担。",
    painPoint: "传统甜咖啡容易造成热量焦虑，普通黑咖啡又可能口感尖锐、缺少愉悦感。",
    coreMessage: "清醒续航，低糖不负担。",
    emotionalHook: "在高压工作日里，用一瓶轻盈冷萃找回对节奏的掌控感。",
    bigIdea: "把低糖冷萃咖啡塑造成城市工作流里的轻量能量插件：打开它，就像给自己切换到高效模式。",
    title: "低糖冷萃咖啡",
    subtitle: "28秒竖版城市通勤广告",
    cta: "开启你的轻负担清醒时刻"
  },
  shots: [
    {
      id: "shot-01-commute",
      index: 1,
      durationSec: 6,
      goal: "建立一线城市通勤场景，让目标用户立刻代入忙碌工作日。",
      visualDescription: "清晨地铁口与写字楼之间，人流快速穿梭，主角从画面侧面进入，手里拿着低糖冷萃咖啡，瓶身在玻璃幕墙反光中被突出。",
      cameraAngle: "中景到中近景，低角度三分之二侧拍",
      cameraMovement: "稳定器跟拍推进，末尾轻微推近瓶身",
      subtitle: "早高峰，也要清醒在线。",
      imagePromptCn: appendNoReadableTextRules("9:16竖版广告关键帧，清晨一线城市通勤场景，年轻上班族手持低糖冷萃咖啡穿过地铁口和玻璃写字楼，冷色调科技感，高级商业摄影，瓶身清晰，城市反光，清爽克制。"),
      imagePromptEn: appendNoReadableTextRules("9:16 vertical advertising keyframe, morning commute in a tier-one city, young office worker holding low sugar cold brew coffee near subway entrance and glass office buildings, cool tech mood, premium commercial photography, clear bottle, urban reflections, clean and refined."),
      videoPromptCn: appendNoReadableTextRules("镜头从人群侧后方稳定推进，主角进入画面并抬起低糖冷萃咖啡，城市玻璃幕墙反光扫过瓶身，节奏快速但画面克制，适合抖音/小红书竖版广告开场。"),
      recommendedModel: "DeepSeek-V4-Flash生成策略/分镜/Prompt；Qwen-Image-2.0预留关键帧；Remotion完成图片动效fallback。",
      fallbackPlan: "如果视频节点不可用，使用通勤关键帧做2.5D轻微推近，叠加速度线和字幕动效。"
    },
    {
      id: "shot-02-product-closeup",
      index: 2,
      durationSec: 7,
      goal: "突出产品质感、低糖卖点和冷萃口感，让用户记住商品本体。",
      visualDescription: "办公桌上电脑亮起，低糖冷萃咖啡位于画面中心，瓶身有细密冷凝水珠，旁边是键盘、会议资料和手机提醒。",
      cameraAngle: "产品近景特写，略带俯拍",
      cameraMovement: "慢速环绕加微距推近，最后停在产品轮廓与材质",
      subtitle: "冷萃顺滑，低糖轻盈。",
      imagePromptCn: appendNoReadableTextRules("低糖冷萃咖啡产品特写，办公桌场景，笔记本电脑屏幕冷光，瓶身冷凝水珠，包装区域无可读字符，深色科技办公氛围，商业产品摄影，高级清爽，9:16竖版构图。"),
      imagePromptEn: appendNoReadableTextRules("Close-up product shot of low sugar cold brew coffee on an office desk, cool laptop screen glow, condensation on the bottle, no readable package text, dark tech office atmosphere, premium refreshing commercial product photography, 9:16 vertical composition."),
      videoPromptCn: appendNoReadableTextRules("镜头围绕咖啡瓶身缓慢移动，微距展示冷凝水珠和材质，电脑屏幕冷光在产品外观上滑过；字幕由 Remotion 后期叠加，模型画面不出现字符。"),
      recommendedModel: "Qwen-Image-2.0预留中文海报级关键帧；Remotion用关键帧动效完成该镜头。",
      fallbackPlan: "使用产品特写静帧，叠加水珠高光、屏幕光扫过和字幕淡入动画，合成为图片动效视频。"
    },
    {
      id: "shot-03-selling-points",
      index: 3,
      durationSec: 7,
      goal: "把低糖、冷萃、轻负担三个核心卖点信息可视化。",
      visualDescription: "咖啡瓶居中悬浮在深色背景前，周围浮现三组无字符的几何光环，背景有轻微城市数据流光；卖点文字由 Remotion 后期叠加。",
      cameraAngle: "正面居中构图，产品中近景",
      cameraMovement: "轻微缩放，信息标签依次弹出并围绕瓶身定位",
      subtitle: "低糖 / 冷萃 / 轻负担",
      imagePromptCn: appendNoReadableTextRules("低糖冷萃咖啡瓶身居中展示，深色科技背景，无字符的简洁HUD几何光环围绕产品浮现，画面不生成任何中文、字母或随机字符，高级广告视觉，9:16竖版，干净留白。"),
      imagePromptEn: appendNoReadableTextRules("Centered low sugar cold brew coffee bottle on a dark tech background, clean geometric HUD rings around the product, no readable labels, no letters, no pseudo-text, premium advertising visual, 9:16 vertical layout, clean negative space."),
      videoPromptCn: appendNoReadableTextRules("产品居中轻微放大，三组无字符的几何光环依次出现；低糖、冷萃、轻负担由 Remotion 后期叠加，背景保持克制流光和轻微粒子，整体像AI广告导演台生成的可解释卖点镜头。"),
      recommendedModel: "DeepSeek-V4-Flash规划卖点结构与Prompt；Qwen-Image-2.0预留关键帧；Remotion合成HUD动效。",
      fallbackPlan: "使用Qwen-Image关键帧占位加Remotion文字和HUD动画，跳过真实视频模型。"
    },
    {
      id: "shot-04-hero-ending",
      index: 4,
      durationSec: 8,
      goal: "完成品牌记忆、情绪收束和行动召唤，形成唯一真实AI视频镜头预留位。",
      visualDescription: "傍晚城市天台，主角手持低糖冷萃咖啡看向天际线，产品和人物剪影同框，最终保留干净的文案安全区；标题、核心口号和 CTA 由 Remotion 后期叠加。",
      cameraAngle: "中景背侧角度，结尾切到产品英雄近景",
      cameraMovement: "缓慢拉远后切产品近景，结尾定格",
      subtitle: "清醒续航，低糖不负担。",
      imagePromptCn: appendNoReadableTextRules("城市天台傍晚，一线城市上班族手持低糖冷萃咖啡远眺天际线，产品与人物剪影同框，深色科技感，高级清爽，竖版广告英雄镜头，适合小红书和抖音。"),
      imagePromptEn: appendNoReadableTextRules("Evening city rooftop, tier-one city office worker holding low sugar cold brew coffee and looking at the skyline, product and silhouette in the same frame, dark tech mood, premium refreshing style, vertical ad hero shot for Xiaohongshu and Douyin."),
      videoPromptCn: appendNoReadableTextRules("镜头从人物背侧缓慢拉远，城市天际线和产品形成记忆点，最后切到咖啡瓶英雄近景并保留干净安全区，不生成文字；标题、口号和 CTA 由 Remotion 后期叠加。当前只准备给 HappyHorse 的详细视频 Prompt，后续用它生成这一条核心 AI 视频镜头。"),
      recommendedModel: "HappyHorse 视频生成模型；Remotion完成标题、字幕和CTA合成。",
      fallbackPlan: "如果核心视频镜头失败，使用天台关键帧做慢速拉远、景深模糊和品牌字幕收束，输出图片动效视频。"
    }
  ],
  modelRoutes: [
    {
      taskType: "strategy",
      primaryModel: "DeepSeek-V4-Flash",
      backupModel: "coldBrewDemo mock fallback",
      reason: "广告策略进入第二阶段真实文本主链路，由DeepSeek统一负责思考与结构化输出。",
      estimatedCost: 0.4,
      estimatedLatency: "3-8s",
      fallbackMode: "失败后读取mock策略"
    },
    {
      taskType: "storyboard",
      primaryModel: "DeepSeek-V4-Flash",
      backupModel: "coldBrewDemo mock fallback",
      reason: "4镜头分镜与镜头目标继续由DeepSeek生成，避免额外文本模型造成成本和风格漂移。",
      estimatedCost: 0.5,
      estimatedLatency: "3-8s",
      fallbackMode: "失败后读取mock分镜"
    },
    {
      taskType: "prompt",
      primaryModel: "DeepSeek-V4-Flash",
      backupModel: "coldBrewDemo mock fallback",
      reason: "图片Prompt、视频Prompt和降级描述由DeepSeek统一生成，保证策略到Prompt的一致性。",
      estimatedCost: 0.5,
      estimatedLatency: "3-8s",
      fallbackMode: "失败后读取mock Prompt"
    },
    {
      taskType: "scoring",
      primaryModel: "DeepSeek-V4-Flash",
      backupModel: "rule-based mock score",
      reason: "广告评分用于后续判断策略完整度、分镜可执行性和成本风险，第二阶段仍由DeepSeek文本链路承担。",
      estimatedCost: 0.2,
      estimatedLatency: "2-5s",
      fallbackMode: "失败后使用规则评分"
    },
    {
      taskType: "image",
      primaryModel: "Qwen-Image-2.0",
      backupModel: "mock-keyframe-fallback",
      reason: "第二阶段不真实调用图片API，仅生成中文海报和关键帧节点。",
      estimatedCost: 4.8,
      estimatedLatency: "reserved",
      fallbackMode: "使用mock关键帧和Prompt卡片"
    },
    {
      taskType: "video",
      primaryModel: "happyhorse-1.0-r2v",
      backupModel: "Qwen-Image keyframe + Remotion fallback",
      reason: "为了控制成本，MVP只生成1个真实AI视频镜头；视频节点统一使用 HappyHorse；当前先返回计划状态，后续接入真实 HappyHorse API。",
      estimatedCost: 3,
      estimatedLatency: "planned",
      fallbackMode: "其余镜头使用Qwen-Image关键帧 + Remotion图片动效"
    },
    {
      taskType: "render",
      primaryModel: "Remotion",
      backupModel: "static-mock-renderer",
      reason: "Remotion负责低成本成片预留：拼接关键帧、一个核心视频镜头、字幕、CTA和失败降级动效。",
      estimatedCost: 1.4,
      estimatedLatency: "reserved",
      fallbackMode: "输出静态预览和图片动效视频"
    }
  ],
  costEstimates: [
    {
      mode: "lowCost",
      label: "最低成本演示模式",
      minCny: 8,
      maxCny: 15,
      explanation: "DeepSeek + Qwen-Image关键帧 + HappyHorse视频节点 + Remotion。当前不调用真实视频API，先用1个Hero Shot详细视频Prompt控制成本。"
    },
    {
      mode: "qualityFirst",
      label: "自动化视频模式",
      minCny: 15,
      maxCny: 35,
      explanation: "DeepSeek + Qwen-Image关键帧 + HappyHorse真实视频 + Remotion。后续接入HappyHorse API后，核心视频镜头切到自动化生成链路。"
    }
  ],
  heroShotId: "shot-3",
  status: "completed",
  assets: [
    {
      id: "asset-shot-01-keyframe",
      type: "image",
      name: "shot-01-commute-keyframe.png",
      url: "/mock/coldbrew/shot-01-commute.png",
      status: "mock"
    },
    {
      id: "asset-shot-02-keyframe",
      type: "image",
      name: "shot-02-product-closeup.png",
      url: "/mock/coldbrew/shot-02-product-closeup.png",
      status: "mock"
    },
    {
      id: "asset-shot-03-keyframe",
      type: "image",
      name: "shot-03-selling-points.png",
      url: "/mock/coldbrew/shot-03-selling-points.png",
      status: "mock"
    },
    {
      id: "asset-shot-04-keyframe",
      type: "image",
      name: "shot-04-hero-ending.png",
      url: "/mock/coldbrew/shot-04-hero-ending.png",
      status: "mock"
    },
    {
      id: "asset-final-video",
      type: "video",
      name: "coldbrew-vertical-ad-18s.mp4",
      url: "/mock/coldbrew/final-vertical-ad.mp4",
      status: "mock"
    },
    {
      id: "asset-fallback-motion",
      type: "render",
      name: "coldbrew-fallback-motion-video.mp4",
      url: "/mock/coldbrew/fallback-motion-video.mp4",
      status: "mock"
    }
  ],
  finalVideoUrl: "/mock/coldbrew/final-vertical-ad.mp4",
  createdAt: "2026-07-03T09:00:00.000Z",
  updatedAt: "2026-07-03T10:00:00.000Z"
});






