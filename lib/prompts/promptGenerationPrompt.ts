import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "./noReadableText";
import type { AdStrategy, ProductBrief, StoryboardShot } from "../schemas/project";
import { createShotPromptTimeSegments } from "../video/shotConfig";

const allowedModels = ["deepseek-v4-flash", "qwen-image", "happyhorse-1.0-r2v", "remotion"];

export function buildPromptGenerationPrompt(
  brief: ProductBrief,
  strategy: AdStrategy,
  shots: StoryboardShot[]
): string {
  const totalDurationSec = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  const heroShot = shots.find((shot) => shot.recommendedModel === "happyhorse-1.0-r2v") ?? shots[Math.max(0, shots.length - 2)];
  const heroSegments = createShotPromptTimeSegments(heroShot?.durationSec ?? 5);
  const example = {
    shots: shots.map((shot) => ({
      ...shot,
      imagePromptCn: `${brief.aspectRatio} 广告关键帧；详细描述镜头 ${shot.index} 的场景、主体、真实产品一致性、光线、构图、材质和商业摄影质感；不生成任何可读文字。`,
      imagePromptEn: `${brief.aspectRatio} advertising keyframe for shot ${shot.index}; detailed scene, subject, product consistency, lighting, composition and commercial photography; no readable text.`,
      videoPromptCn: shot.id === heroShot?.id
        ? `基于当前主镜头关键帧与真实产品参考图生成 ${shot.durationSec} 秒广告视频；${heroSegments[0].startSec}–${heroSegments[0].endSec} 秒建立产品，${heroSegments[1].startSec}–${heroSegments[1].endSec} 秒缓慢推进或轻微横移，${heroSegments[2].startSec}–${heroSegments[2].endSec} 秒稳定产品并完成光线变化；保持产品包装结构、材质、颜色和比例，不新增人物，不改变构图，不生成文字。`
        : "该镜头使用 Qwen-Image 关键帧与 Remotion 图片动效，不生成独立视频。",
      recommendedModel: shot.id === heroShot?.id ? "happyhorse-1.0-r2v" : shot.index === shots.length ? "remotion" : "qwen-image",
      fallbackPlan: "生成失败时使用关键帧与 Remotion 图片动效完成。"
    }))
  };

  return `你是广告生成工作流的提示词导演。请完善每个镜头的图片提示词、视频提示词、推荐模型和降级方案。

只输出合法 json，不要输出 Markdown、解释、注释或代码围栏。除 imagePromptEn 外，所有字段必须使用简体中文。

商品简报：
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

广告策略：
${JSON.stringify(strategy, null, 2)}

分镜输入：
${JSON.stringify(shots, null, 2)}

硬性要求：
- 必须原样返回 ${shots.length} 个镜头，不得新增、删除、重排镜头，也不得改变 id、index 和 durationSec。
- 镜头时长总和为 ${totalDurationSec} 秒，必须保持不变。
- 当前画幅为 ${brief.aspectRatio}，平台为 ${brief.platform}。
- 全片只允许 1 个主镜头使用 HappyHorse，主镜头优先为镜头 ${heroShot?.index ?? 1}，时长 ${heroShot?.durationSec ?? 5} 秒。
- 其他镜头使用 Qwen-Image 关键帧与 Remotion 图片动效；最后一个镜头用于 CTA 合成。
- recommendedModel 只能是：${allowedModels.join("、")}。
- imagePromptCn 使用 100–220 个中文字符，明确场景、主体、产品一致性、光线、构图、景别、质感、背景和安全要求。
- imagePromptEn 与中文图片提示词语义一致，必须是详细英文视觉提示词。
- 主镜头 videoPromptCn 使用 120–260 个中文字符，明确参考关键帧和真实产品图、镜头运动、主体动作、光线变化与产品一致性。
- 非主镜头 videoPromptCn 明确说明采用关键帧加 Remotion 动效。
- 每条字幕不超过 16 个中文字符。
- 禁止明星肖像、影视/动漫/游戏 IP、竞品 Logo、虚假功效、医疗或金融夸大承诺。
${productImageReferenceNote(brief)}
- 每个图片与视频提示词都必须包含以下无文字约束：
${NO_READABLE_TEXT_CN}
${NO_READABLE_TEXT_EN}
- 所有可读字幕、标题、卖点与 CTA 只由 Remotion 后期叠加，不得进入模型画面像素。

目标 JSON 示例：
${JSON.stringify(example, null, 2)}`;
}