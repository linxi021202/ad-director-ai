import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import type { AdStrategy, ProductBrief, StoryboardShot } from "../schemas/project";

export function buildAdScorePrompt(
  brief: ProductBrief,
  strategy: AdStrategy,
  shots: StoryboardShot[]
): string {
  const totalDurationSec = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  return `你是短视频广告质量评审与工作流审核员。

只输出合法 json，不要输出 Markdown、解释、注释或代码围栏。所有面向用户的字段必须使用简体中文。

商品简报：
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

广告策略：
${JSON.stringify(strategy, null, 2)}

分镜与提示词：
${JSON.stringify(shots, null, 2)}

审核清单：
${productImageReferenceNote(brief)}
- 当前项目包含 ${shots.length} 个镜头，镜头时长总和为 ${totalDurationSec} 秒，目标时长为 ${brief.durationSec} 秒。
- 每条字幕不超过 16 个中文字符。
- 画幅必须匹配 ${brief.aspectRatio}，平台表达适合 ${brief.platform}。
- 只生成 1 个 Wan 2.7 I2V 主镜头视频，且只允许输入一张完整主镜头关键帧；其他镜头使用 Qwen-Image 关键帧与 Remotion 图片动效。
- recommendedModel 只能使用 deepseek-v4-pro、qwen-image、wan2.7-i2v、remotion。
- 禁止明星肖像、影视/动漫/游戏 IP、竞品 Logo、虚假功效和医疗/金融夸大承诺。
- 若出现允许列表之外的模型，必须降低评分并写入 forbiddenModelsFound。

目标 JSON 示例：
{
  "overallScore": 86,
  "dimensionScores": {
    "strategyClarity": 18,
    "storyboardExecution": 17,
    "promptQuality": 18,
    "costControl": 17,
    "brandSafety": 16
  },
  "passed": true,
  "summary": "方案结构清晰，模型职责明确，具备可执行的降级路径。",
  "risks": ["主镜头生成失败时需要启用关键帧动效降级。"],
  "fixSuggestions": ["继续压缩字幕，确保移动端可读。"],
  "modelRouteCheck": {
    "allowedOnly": true,
    "usedModels": ["deepseek-v4-pro", "qwen-image", "wan2.7-i2v", "remotion"],
    "forbiddenModelsFound": []
  },
  "videoGenerationStrategyCheck": {
    "heroShotOnly": true,
    "realVideoShots": 1,
    "fallbackReady": true
  }
}`;
}
