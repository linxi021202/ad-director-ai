import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "./noReadableText";
import type { AdStrategy, ProductBrief, StoryboardShot } from "../schemas/project";

const allowedModels = ["deepseek-v4-flash", "qwen-image", "happyhorse-1.0-r2v", "remotion"];

export function buildPromptGenerationPrompt(
  brief: ProductBrief,
  strategy: AdStrategy,
  shots: StoryboardShot[]
): string {
  return `You are a prompt director for Xiaohongshu/Douyin 9:16 vertical ad generation.

Complete image prompts, video prompts, recommended models, and fallback plans for each shot. Output legal json only. Do not output markdown, explanations, comments, or code fences.
All fields must be Simplified Chinese except imagePromptEn, which must be English by field definition. Subtitles must be no more than 16 Chinese characters.

Product brief:
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

Ad strategy:
${JSON.stringify(strategy, null, 2)}

Storyboard input:
${JSON.stringify(shots, null, 2)}

Hard constraints:
${productImageReferenceNote(brief)}
- Every imagePromptCn and videoPromptCn must include the following no-text rules:
${NO_READABLE_TEXT_CN}
${NO_READABLE_TEXT_EN}
- Subtitles, selling-point labels, titles and CTA are metadata for Remotion overlays only; Qwen-Image and HappyHorse must not render them into pixels.
- If accurate readable packaging is required, use the user-uploaded real product image in Remotion instead of asking a model to redraw package text.
- The ad must fit Xiaohongshu/Douyin 9:16 vertical short video.
- Output exactly 4 shots, total duration 25-30 seconds.
- Only 1 Hero Shot may be generated with HappyHorse reference-to-video. It must use uploaded real product images as product references and the Hero keyframe as scene reference. Other shots use Qwen-Image keyframes + Remotion image motion.
- recommendedModel must only be one of: ${allowedModels.join(", ")}.
- imagePromptCn must be concrete and detailed, preferably 80-140 Chinese characters, describing vertical keyframe, product appearance, scene, lighting, composition, lens feel, texture, background, and brand-safety constraints.
- imagePromptEn must be a detailed English visual prompt matching imagePromptCn and avoid exaggerated claims.
- videoPromptCn must be concrete and detailed, preferably 80-160 Chinese characters, describing HappyHorse reference-to-video intent, 4-5 second duration, camera movement, subject action and light changes. It must preserve product shape, materials, colors and proportions while forbidding all readable package text and Logo text.
- fallbackPlan must explain how keyframes + Remotion image motion complete the shot.
- Do not use celebrity likeness, film/TV/anime/game IP, competitor Logo, false efficacy claims, or exaggerated medical/financial promises.
- Do not use any model name outside the allowed model list.
- Do not mention any model outside the allowed model list.

Target JSON example:
{
  "shots": [
    {
      "id": "shot-01-commute",
      "index": 1,
      "durationSec": 6,
      "goal": "建立城市通勤代入感",
      "visualDescription": "清晨地铁口和写字楼之间，上班族手持低糖冷萃咖啡进入画面。",
      "cameraAngle": "中景到中近景",
      "cameraMovement": "稳定跟拍推进",
      "subtitle": "清醒准时上线",
      "imagePromptCn": "9:16竖版广告关键帧，清晨一线城市地铁口，年轻上班族手持低糖冷萃咖啡，玻璃写字楼反光，冷色科技感，产品外观清晰，包装区域无可读字符，无明星肖像，无竞品Logo，无虚假功效承诺。",
      "imagePromptEn": "9:16 vertical ad keyframe, morning subway entrance in a tier-one city, young office worker holding low sugar cold brew coffee, glass office reflections, cool tech mood, clear product package, no celebrity likeness, no competitor logo.",
      "videoPromptCn": "跟拍推进，人物从人流中进入画面，产品自然抬起，节奏快速但画面克制。",
      "recommendedModel": "qwen-image",
      "fallbackPlan": "使用关键帧做 2.5D 推进，叠加冷光和字幕动效。"
    },
    {
      "id": "shot-02-desk",
      "index": 2,
      "durationSec": 7,
      "goal": "强调低糖轻负担",
      "visualDescription": "办公桌面中产品与电脑并置，画面保留克制、干净的卖点文字安全区。",
      "cameraAngle": "俯拍特写",
      "cameraMovement": "轻微下压",
      "subtitle": "低糖不打断",
      "imagePromptCn": "9:16竖版办公桌关键帧，低糖冷萃咖啡居中，电脑、便签、冷色桌面，卖点留白清晰，无夸大健康功效，无竞品Logo。",
      "imagePromptEn": "9:16 vertical desk keyframe, low sugar cold brew centered, laptop and sticky notes, cool desktop, clear space for benefit tags, no exaggerated health claims.",
      "videoPromptCn": "关键帧轻微下压，光线扫过瓶身，只做光线变化和产品运动；低糖标签由 Remotion 后期叠加。",
      "recommendedModel": "qwen-image",
      "fallbackPlan": "用关键帧视差、光扫和字幕动效完成。"
    },
    {
      "id": "shot-03-hero",
      "index": 3,
      "durationSec": 7,
      "goal": "生成唯一 Hero Shot",
      "visualDescription": "会议前人物拿起咖啡，情绪从疲惫切换到专注，产品始终清晰。",
      "cameraAngle": "中近景",
      "cameraMovement": "缓慢环绕推近",
      "subtitle": "状态轻轻回来",
      "imagePromptCn": "9:16竖版Hero关键帧，会议前上班族手持低糖冷萃咖啡，背景干净，人物自然，产品包装清楚，无明星肖像。",
      "imagePromptEn": "9:16 vertical hero keyframe, office worker before a meeting holding low sugar cold brew coffee, clean background, natural person, clear product package.",
      "videoPromptCn": "只生成这1个真实AI视频镜头，4到5秒，缓慢环绕推近，人物轻饮一口，状态由疲惫转为专注。",
      "recommendedModel": "happyhorse-1.0-r2v",
      "fallbackPlan": "若Hero视频失败，使用关键帧加 Remotion 推近、光效和字幕完成。"
    },
    {
      "id": "shot-04-cta",
      "index": 4,
      "durationSec": 8,
      "goal": "强化产品和CTA",
      "visualDescription": "产品站在办公窗边，城市背景虚化，保留干净的 CTA 与卖点安全区，不生成字符。",
      "cameraAngle": "产品特写",
      "cameraMovement": "定帧轻推近",
      "subtitle": "今天低糖清醒",
      "imagePromptCn": "9:16竖版结尾产品关键帧，低糖冷萃咖啡包装清晰，窗边城市虚化，CTA留白，无竞品Logo，无虚假承诺。",
      "imagePromptEn": "9:16 vertical closing product keyframe, clear low sugar cold brew package, blurred city background by office window, clean CTA space, no competitor logo.",
      "videoPromptCn": "定帧轻推近，只做定帧轻推近并保留干净安全区；卖点标签和 CTA 由 Remotion 合成。",
      "recommendedModel": "remotion",
      "fallbackPlan": "用产品关键帧、标签动效和片尾CTA合成完整结尾。"
    }
  ],
  "videoGenerationStrategy": {
    "heroShotIndex": 3,
    "heroShotModel": "happyhorse-1.0-r2v",
    "realVideoShots": 1,
    "nonHeroShotPlan": "镜头1、2、4使用 Qwen-Image 关键帧 + Remotion 图片动效。",
    "fallbackPlan": "Hero Shot 失败时，全片输出图片动效视频。"
  }
}`;
}






