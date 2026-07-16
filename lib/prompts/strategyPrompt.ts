import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import type { ProductBrief } from "../schemas/project";

const forbiddenRules = [
  "Do not use celebrity likeness or imply celebrity endorsement.",
  "Do not use film, TV, anime, game IP, or recognizable IP elements.",
  "Do not show competitor logos, packages, or recognizable competitor names.",
  "Do not make false efficacy claims or guaranteed functional promises.",
  "Do not make exaggerated medical or financial promises."
];

export function buildStrategyPrompt(brief: ProductBrief): string {
  return `You are an AI advertising strategy director for Xiaohongshu/Douyin 9:16 vertical short video ads.

Generate the ad strategy from the product brief. Output legal json only. Do not output markdown, explanations, comments, or code fences.
All user-facing values must be Simplified Chinese.

Product brief:
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

Hard constraints:
${productImageReferenceNote(brief)}
- The ad is for Xiaohongshu/Douyin 9:16 vertical short video.
- Total duration must stay within 25-30 seconds.
- The storyboard must have exactly 4 shots.
- Subtitles in later storyboard must be short Chinese phrases, each no more than 16 Chinese characters.
- Video strategy must clearly state: generate only 1 Hero Shot with HappyHorse happyhorse-1.0-r2v; use the uploaded real product images as product references and the Hero keyframe as scene reference; all other shots use Qwen-Image keyframes + Remotion image motion.
- Recommended model values in later workflow must only be: deepseek-v4-flash, qwen-image, happyhorse-1.0-r2v, remotion.
${forbiddenRules.map((rule) => `- ${rule}`).join("\n")}

Target JSON example:
{
  "audienceInsight": "一线城市上班族需要快速恢复清醒，但不想被高糖饮品增加负担。",
  "painPoint": "下午低电量时想喝咖啡，又担心甜腻和热量。",
  "coreMessage": "清醒续航，低糖不负担。",
  "emotionalHook": "在紧凑工作日里重新拿回节奏感。",
  "bigIdea": "把低糖冷萃咖啡包装成城市工作流里的轻量能量插件。",
  "title": "低糖冷萃咖啡",
  "subtitle": "28秒竖版城市通勤广告",
  "cta": "开启轻负担清醒时刻"
}`;
}





