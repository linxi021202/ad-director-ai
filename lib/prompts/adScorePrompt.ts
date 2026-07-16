import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import type { AdStrategy, ProductBrief, StoryboardShot } from "../schemas/project";

export function buildAdScorePrompt(
  brief: ProductBrief,
  strategy: AdStrategy,
  shots: StoryboardShot[]
): string {
  return `You are a short-video ad quality reviewer and cost-control PM.

Evaluate the current Xiaohongshu/Douyin 9:16 vertical ad plan. Output legal json only. Do not output markdown, explanations, comments, or code fences.
All user-facing values must be Simplified Chinese. Focus on strategy clarity, storyboard execution, prompt quality, cost control, brand safety, and fallback readiness.

Product brief:
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

Ad strategy:
${JSON.stringify(strategy, null, 2)}

Storyboard and prompts:
${JSON.stringify(shots, null, 2)}

Checklist:
${productImageReferenceNote(brief)}
- Exactly 4 shots.
- Total duration is 25-30 seconds.
- Subtitles are short Chinese phrases, each no more than 16 Chinese characters.
- Fits Xiaohongshu/Douyin 9:16 vertical short video.
- States that only 1 Hero Shot is generated with HappyHorse as real AI video, while other shots use Qwen-Image keyframes + Remotion image motion.
- recommendedModel only uses deepseek-v4-flash, qwen-image, happyhorse, remotion.
- No celebrity likeness, film/TV/anime/game IP, competitor Logo, false efficacy claims, or exaggerated medical/financial promises.
- Any model name outside the allowed model list must reduce the score and be reported.
- If any model outside the allowed model list appears in the current MVP plan, report it in forbiddenModelsFound.

Target JSON example:
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
  "summary": "方案适合9:16竖版广告，主链路清晰，成本可控。",
  "risks": ["Hero Shot如果无法生成，需要准备关键帧动效降级。"],
  "fixSuggestions": ["进一步压缩字幕，保证移动端可读。"],
  "modelRouteCheck": {
    "allowedOnly": true,
    "usedModels": ["deepseek-v4-flash", "qwen-image", "happyhorse-1.0-r2v", "remotion"],
    "forbiddenModelsFound": []
  },
  "videoGenerationStrategyCheck": {
    "heroShotOnly": true,
    "realVideoShots": 1,
    "fallbackReady": true
  }
}`;
}





