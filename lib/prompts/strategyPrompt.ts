import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import type { ProductBrief } from "../schemas/project";
import { resolveShotPlan } from "../video/shotConfig";

const forbiddenRules = [
  "禁止明星肖像或暗示明星代言。",
  "禁止影视、动漫、游戏 IP 或可识别的受保护元素。",
  "禁止竞品 Logo、包装或竞品名称。",
  "禁止虚假功效和保证性承诺。",
  "禁止医疗或金融夸大承诺。"
];

type ShotPlanInput = { requestedShotCount?: number; targetDurationSec?: number; shotDurationPlan?: number[] };

export function buildStrategyPrompt(brief: ProductBrief, input: ShotPlanInput = {}): string {
  const timeline = resolveShotPlan(input.requestedShotCount, input.shotDurationPlan, input.targetDurationSec ?? brief.durationSec);
  return `你是广告策略导演。请根据商品简报生成可执行的广告策略。

只输出合法 json，不要输出 Markdown、解释、注释或代码围栏。所有面向用户的字段必须使用简体中文。

商品简报：
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

硬性要求：
${productImageReferenceNote(brief)}
- 当前画幅为 ${brief.aspectRatio}，目标平台为 ${brief.platform}。
- 项目将生成 ${timeline.shotCount} 个镜头，时长计划为 ${timeline.shotDurationPlan.join("、")} 秒，总时长 ${timeline.totalDurationSec} 秒。
- 后续字幕必须是短中文句，每条不超过 16 个中文字符。
- 视频策略只生成 1 个 HappyHorse 主镜头；使用上传的真实产品图保持产品一致性，并使用主镜头关键帧保持构图。
- 其他镜头使用 Qwen-Image 关键帧与 Remotion 图片动效，最后由 Remotion 合成完整广告。
- 后续推荐模型只能是：deepseek-v4-flash、qwen-image、happyhorse-1.0-r2v、remotion。
${forbiddenRules.map((rule) => `- ${rule}`).join("\n")}

目标 JSON 示例：
{
  "audienceInsight": "目标用户在高压工作场景中需要快速恢复清醒，同时希望控制糖分负担。",
  "painPoint": "需要提神饮品，但担心甜腻、热量和状态波动。",
  "coreMessage": "清醒续航，低糖不负担。",
  "emotionalHook": "在忙碌工作日里重新拿回节奏感。",
  "bigIdea": "把产品塑造成工作流中的轻量能量补给。",
  "title": "低糖冷萃咖啡",
  "subtitle": "${timeline.totalDurationSec} 秒品牌广告",
  "cta": "开启轻负担清醒时刻"
}`;
}
