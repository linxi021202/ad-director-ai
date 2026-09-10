import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import type { ProductBrief, ProductVisualSpec } from "../schemas/project";
import { resolveShotPlan } from "../video/shotConfig";
import { serializeProductVisualSpecForPrompt } from "../visual/productVisualSpec";

const forbiddenRules = [
  "禁止明星肖像或暗示明星代言。",
  "禁止影视、动漫、游戏 IP 或可识别的受保护元素。",
  "禁止竞品 Logo、包装或竞品名称。",
  "禁止虚假功效和保证性承诺。",
  "禁止医疗或金融夸大承诺。"
];

type ShotPlanInput = { requestedShotCount?: number; targetDurationSec?: number; shotDurationPlan?: number[]; productVisualSpec?: ProductVisualSpec };

export function buildStrategyPrompt(brief: ProductBrief, input: ShotPlanInput = {}): string {
  const timeline = resolveShotPlan(input.requestedShotCount, input.shotDurationPlan, input.targetDurationSec ?? brief.durationSec);
  return `你是商业广告导演、叙事导演、连续性导演和提示词导演。请根据商品简报生成可执行的广告策略与 Creative Bible 基础信息。

只输出合法 json，不要输出 Markdown、解释、注释或代码围栏。所有面向用户的字段必须使用简体中文。

商品简报：
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

${serializeProductVisualSpecForPrompt(input.productVisualSpec)}

硬性要求：
${productImageReferenceNote(brief)}
- 当前画幅为 ${brief.aspectRatio}，目标平台为 ${brief.platform}。
- 项目将生成 ${timeline.shotCount} 个镜头，时长计划为 ${timeline.shotDurationPlan.join("、")} 秒，总时长 ${timeline.totalDurationSec} 秒。
- 后续字幕必须是短中文句，每条不超过 16 个中文字符。
- 规划完整商业结构：Hook、Problem、Product Reveal、Benefit、Emotional Payoff、CTA。
- 不得发明价格、折扣、功效数字、临床数据、认证、排名、百分比或“市场第一”。
- 事实性广告声明只能来自 verifiedClaims：${JSON.stringify(brief.verifiedClaims ?? [])}。
- 视频策略只生成 1 个 Wan 2.7 I2V 广告镜头；先由真实产品图生成一张完整主镜头关键帧，再仅使用这一张关键帧生成视频。
- 其他镜头使用 Qwen-Image 关键帧与 Remotion 图片动效，最后由 Remotion 合成完整广告。
- 相邻关键帧必须形成明显的叙事推进：改变景别、摄影机轴位或主体动作中的至少两项，禁止连续生成近似背景图。
- 每个 3–8 秒镜头规划多个按时间依次发生的简单微动作和一条连续运镜；不得规划切镜或同时发生的多个时间点。
- 后续推荐模型只能是：deepseek-v4-pro、qwen-image、wan2.7-i2v、remotion。
${forbiddenRules.map((rule) => `- ${rule}`).join("\n")}

目标 JSON 示例：
{
  "audienceInsight": "目标用户在高压工作场景中需要快速恢复清醒，同时希望控制糖分负担。",
  "painPoint": "需要提神饮品，但担心甜腻、热量和状态波动。",
  "coreMessage": "清醒续航，低糖不负担。",
  "emotionalHook": "在忙碌工作日里重新拿回节奏感。",
  "bigIdea": "把产品塑造成工作流中的轻量能量补给。",
  "emotionalArc": "疲惫失速，到重新掌控节奏。",
  "narrativeArc": "工作压力建立，产品出现，状态转变，行动收束。",
  "visualMetaphor": "产品像工作流中的轻量能量开关。",
  "visualStyle": "清爽、克制、真实的商业摄影。",
  "cameraLanguage": "稳定推进与产品近景为主。",
  "pacing": "开场快速，中段清楚，结尾稳定。",
  "productImportance": "hero",
  "commercialStructure": {
    "hook": "工作状态快速下滑。",
    "problem": "用户需要清醒但不想增加负担。",
    "productReveal": "真实产品在核心场景中清晰出现。",
    "benefit": "清醒续航，低糖不负担。",
    "emotionalPayoff": "重新拿回工作节奏。",
    "cta": "开启轻负担清醒时刻"
  },
  "forbiddenConcepts": ["虚假功效", "未经提供的价格或数字", "竞品和受保护IP"],
  "title": "低糖冷萃咖啡",
  "subtitle": "${timeline.totalDurationSec} 秒品牌广告",
  "cta": "开启轻负担清醒时刻"
}`;
}
