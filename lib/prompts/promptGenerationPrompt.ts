import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "./noReadableText";
import type { AdStrategy, ProductBrief, ProductVisualSpec, StoryboardShot } from "../schemas/project";
import { serializeProductVisualSpecForPrompt } from "../visual/productVisualSpec";
import { SINGLE_FRAME_HARD_CONSTRAINT_CN, SINGLE_VIDEO_HARD_CONSTRAINT_CN } from "./singleComposition";

const allowedModels = ["deepseek-v4-pro", "qwen-image", "wan2.7-i2v", "remotion"];

export function buildPromptGenerationPrompt(
  brief: ProductBrief,
  strategy: AdStrategy,
  shots: StoryboardShot[],
  productVisualSpec?: ProductVisualSpec
): string {
  const totalDurationSec = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  const heroShot = shots.find((shot) => /wan2\.7-(?:i2v|r2v)/i.test(shot.recommendedModel)) ?? shots[Math.max(0, shots.length - 2)];
  const example = {
    shots: shots.map((shot) => ({
      ...shot,
      imagePromptCn: `${brief.aspectRatio} 广告关键帧；详细描述镜头 ${shot.index} 的场景、主体、真实产品一致性、光线、构图、材质和商业摄影质感；不生成任何可读文字。`,
      imagePromptEn: `${brief.aspectRatio} advertising keyframe for shot ${shot.index}; detailed scene, subject, product consistency, lighting, composition and commercial photography; no readable text.`,
      videoPromptCn: shot.id === heroShot?.id
        ? `基于独立完整的首帧（可选独立尾帧）生成 ${shot.durationSec} 秒广告视频；同一时空内按秒点完成简单微动作链和一条连续运镜；保持产品包装结构、材质、颜色和比例，不新增人物，不生成文字。${SINGLE_VIDEO_HARD_CONSTRAINT_CN}`
        : "该镜头使用 Qwen-Image 关键帧与 Remotion 图片动效，不生成独立视频。",
      recommendedModel: shot.id === heroShot?.id ? "wan2.7-i2v" : shot.index === shots.length ? "remotion" : "qwen-image",
      fallbackPlan: "生成失败时使用关键帧与 Remotion 图片动效完成。"
    }))
  };

  return `你是广告生成工作流的提示词导演。当前请求只包含一个镜头。请深度完善该镜头的图片提示词、视频提示词、推荐模型和降级方案。

只输出合法 json，不要输出 Markdown、解释、注释或代码围栏。除 imagePromptEn 外，所有字段必须使用简体中文。

广告需求：
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

${serializeProductVisualSpecForPrompt(productVisualSpec)}

广告策略：
${JSON.stringify(strategy, null, 2)}

分镜输入：
${JSON.stringify(shots, null, 2)}

硬性要求：
- 必须原样返回 ${shots.length} 个镜头，不得新增、删除、重排镜头，也不得改变 id、index 和 durationSec。
- 必须原样保留 continuityGroupId、sceneGroupId、sceneId、characterIds、productIds、sceneStateBefore、sceneStateAfter、generationMode、motionComplexityScore 与 textSafeZone。
- 必须原样保留 containsProduct 与 exactProductShot；containsProduct=true 时 Product Visual Spec 是不可改写的硬约束。
- continuityConstraints 只描述不可变化的 Master 规则；shotDirection 只描述本镜头允许发生的动作、表演、光线和摄影机变化，不得揉成同一段。
- 镜头时长总和为 ${totalDurationSec} 秒，必须保持不变。
- 当前画幅为 ${brief.aspectRatio}，平台为 ${brief.platform}。
- 全片只允许 1 个主镜头使用 Wan 2.7 I2V，主镜头优先为镜头 ${heroShot?.index ?? 1}，时长 ${heroShot?.durationSec ?? 5} 秒。
- 其他镜头使用 Qwen-Image 关键帧与 Remotion 图片动效；最后一个镜头用于 CTA 合成。
- recommendedModel 只能是：${allowedModels.join("、")}。
- imagePromptCn 使用 400–800 个中文字符，明确唯一冻结瞬间、场景、主体、产品一致性、人物姿态与手部、前中后景、机位、焦段、景深、光线方向与质量、阴影、反射、材质、色彩、空间关系和安全要求。
- imagePromptEn 与中文图片提示词语义一致，使用 250–450 个英文单词，必须是完整详细的英文视觉提示词。
- 图片提示词必须包含：${SINGLE_FRAME_HARD_CONSTRAINT_CN} 相邻关键帧的景别、轴位、动作或产品使用阶段至少两项不同。
- 主镜头 videoPromptCn 必须详细描述开始状态、按秒时间轴、人物动作、手部动作、产品动作、摄影机动作、环境变化、结束状态和禁止变化；只允许同一时空中的一条连续运镜，不得切镜或同屏展示多个时间点，并必须包含：${SINGLE_VIDEO_HARD_CONSTRAINT_CN}
- 非主镜头 videoPromptCn 明确说明采用关键帧加 Remotion 动效。
- 每条字幕不超过 16 个中文字符。
- 禁止明星肖像、影视/动漫/游戏 IP、竞品 Logo、虚假功效、医疗或金融夸大承诺。
${productImageReferenceNote(brief)}
- 每个图片与视频提示词都必须包含以下无文字约束：
${NO_READABLE_TEXT_CN}
${NO_READABLE_TEXT_EN}
- 所有可读字幕、标题、卖点与 CTA 只由 Remotion 后期叠加，不得进入模型画面像素。
- 价格、折扣、功效数字、认证、排名与百分比只能引用 verifiedClaims：${JSON.stringify(brief.verifiedClaims ?? [])}；不得自行发明。

目标 JSON 示例：
${JSON.stringify(example, null, 2)}`;
}
