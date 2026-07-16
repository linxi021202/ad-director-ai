import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "./noReadableText";
import type { AdStrategy, ProductBrief } from "../schemas/project";

const allowedModels = ["deepseek-v4-flash", "qwen-image", "happyhorse-1.0-r2v", "remotion"];

export function buildStoryboardPrompt(brief: ProductBrief, strategy: AdStrategy): string {
  return `You are a storyboard director for Xiaohongshu/Douyin 9:16 vertical short video ads.

Generate exactly 4 storyboard shots from the product brief and strategy. Output legal json only. Do not output markdown, explanations, comments, or code fences.
All user-facing values must be Simplified Chinese.

Product brief:
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

Ad strategy:
${JSON.stringify(strategy, null, 2)}

Hard constraints:
${productImageReferenceNote(brief)}
- Every imagePromptCn and videoPromptCn must include the following no-text rules:
${NO_READABLE_TEXT_CN}
${NO_READABLE_TEXT_EN}
- Subtitles, selling-point labels, titles and CTA are metadata for Remotion overlays only; Qwen-Image and HappyHorse must not render them into pixels.
- If accurate readable packaging is required, use the user-uploaded real product image in Remotion instead of asking a model to redraw package text.
- Output exactly 4 shots. index must be 1, 2, 3, 4.
- Total duration must be 25-30 seconds. Each durationSec must be an integer.
- The ad must fit Xiaohongshu/Douyin 9:16 vertical short video.
- Only 1 Hero Shot may be planned as HappyHorse reference-to-video; its videoPromptCn must require using uploaded real product images to preserve packaging and the Hero keyframe to preserve composition.
- All non-hero shots must be feasible with Qwen-Image keyframes + Remotion image motion.
- recommendedModel must only be one of: ${allowedModels.join(", ")}.
- Subtitles must be short Chinese phrases, each no more than 16 Chinese characters.
- imagePromptCn and videoPromptCn must return concrete, detailed prompts, not abstract summaries.
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
      "visualDescription": "清晨地铁口与写字楼之间，上班族手持低糖冷萃咖啡快步进入画面。",
      "cameraAngle": "中景到中近景",
      "cameraMovement": "稳定跟拍推进",
      "subtitle": "清醒准时上线",
      "imagePromptCn": "9:16竖版关键帧，清晨一线城市地铁口，年轻上班族手持低糖冷萃咖啡，冷色自然光，产品外观清晰，包装区域无可读字符，无明星肖像，无竞品Logo。",
      "imagePromptEn": "9:16 vertical keyframe, morning subway entrance in a tier-one city, office worker holding low sugar cold brew coffee, cool natural light, clear product appearance, no readable package text.",
      "videoPromptCn": "跟拍推进，上班族从人流中进入画面，产品自然抬起，节奏轻快克制。",
      "recommendedModel": "qwen-image",
      "fallbackPlan": "使用关键帧加 Remotion 推进和字幕动效完成。"
    },
    {
      "id": "shot-02-desk",
      "index": 2,
      "durationSec": 7,
      "goal": "放大低糖轻负担卖点",
      "visualDescription": "办公桌上咖啡、电脑和便签形成清爽构图，产品轮廓与材质清晰，包装区域不出现可读字符。",
      "cameraAngle": "俯拍特写",
      "cameraMovement": "轻微下压",
      "subtitle": "低糖不打断",
      "imagePromptCn": "9:16竖版办公桌关键帧，低糖冷萃咖啡居中，电脑与便签辅助构图，清爽科技感，无夸大功效文字。",
      "imagePromptEn": "9:16 vertical office desk keyframe, low sugar cold brew coffee centered, laptop and notes, clean tech mood, no exaggerated claim text.",
      "videoPromptCn": "画面轻微下压，光线扫过产品外观，字幕由 Remotion 后期叠加，不进入模型画面。",
      "recommendedModel": "qwen-image",
      "fallbackPlan": "使用单张关键帧做视差和光效动画。"
    },
    {
      "id": "shot-03-focus",
      "index": 3,
      "durationSec": 7,
      "goal": "呈现核心 Hero Shot",
      "visualDescription": "人物在会议前拿起咖啡轻饮一口，背景由忙乱切换为清晰有序的工作状态。",
      "cameraAngle": "中近景",
      "cameraMovement": "缓慢环绕推近",
      "subtitle": "状态轻轻回来",
      "imagePromptCn": "9:16竖版Hero镜头关键帧，会议前上班族拿起低糖冷萃咖啡，背景干净，人物自然，产品清晰，无明星肖像。",
      "imagePromptEn": "9:16 vertical hero shot keyframe, office worker before meeting holding low sugar cold brew coffee, clean background, natural person, clear product.",
      "videoPromptCn": "生成唯一真实 AI 视频镜头，缓慢环绕推近，人物轻饮一口，情绪从疲惫转为专注。",
      "recommendedModel": "happyhorse-1.0-r2v",
      "fallbackPlan": "若真实视频失败，改用关键帧加 Remotion 轻推近和状态光效。"
    },
    {
      "id": "shot-04-cta",
      "index": 4,
      "durationSec": 8,
      "goal": "完成产品记忆和行动召唤",
      "visualDescription": "产品站在办公窗边，城市天际线虚化，画面保留干净文案安全区，购买提示和卖点由 Remotion 后期叠加。",
      "cameraAngle": "产品特写",
      "cameraMovement": "定帧轻微推近",
      "subtitle": "今天低糖清醒",
      "imagePromptCn": "9:16竖版结尾产品关键帧，低糖冷萃咖啡包装清晰，办公窗边城市虚化背景，CTA区域留白，无竞品Logo。",
      "imagePromptEn": "9:16 vertical closing product keyframe, clear low sugar cold brew package, office window with blurred city skyline, empty CTA area, no competitor logo.",
      "videoPromptCn": "定帧轻推近，画面定帧轻推近并保留干净安全区；卖点与 CTA 由 Remotion 后期叠加。",
      "recommendedModel": "remotion",
      "fallbackPlan": "使用产品关键帧、标签动效和片尾CTA合成。"
    }
  ],
  "videoGenerationStrategy": {
    "heroShotIndex": 3,
    "realVideoShots": 1,
    "nonHeroShotPlan": "镜头1、2、4使用 Qwen-Image 关键帧 + Remotion 图片动效。",
    "fallbackPlan": "真实视频失败时，全片降级为关键帧图片动效视频。"
  }
}`;
}






