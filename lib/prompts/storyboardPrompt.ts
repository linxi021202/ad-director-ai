import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "./noReadableText";
import type { AdStrategy, ProductBrief } from "../schemas/project";
import { createShotPromptTimeSegments, getDefaultHeroShotArrayIndex, resolveShotPlan } from "../video/shotConfig";

const allowedModels = ["deepseek-v4-flash", "qwen-image", "happyhorse-1.0-r2v", "remotion"];
type ShotPlanInput = { requestedShotCount?: number; targetDurationSec?: number; shotDurationPlan?: number[] };

export function buildStoryboardPrompt(brief: ProductBrief, strategy: AdStrategy, input: ShotPlanInput = {}): string {
  const timeline = resolveShotPlan(
    input.requestedShotCount,
    input.shotDurationPlan,
    input.targetDurationSec ?? (input.shotDurationPlan ? undefined : brief.durationSec)
  );
  const durations = timeline.shotDurationPlan;
  const shotCount = timeline.shotCount;
  const heroIndex = getDefaultHeroShotArrayIndex(shotCount);
  const example = {
    shots: durations.map((durationSec, zeroBasedIndex) => {
      const index = zeroBasedIndex + 1;
      const isHero = zeroBasedIndex === heroIndex;
      const isClosing = zeroBasedIndex === shotCount - 1;
      const [opening, development, closing] = createShotPromptTimeSegments(durationSec);
      const continuityGroupId = isClosing ? "ending" : isHero ? "product-world" : "narrative-main";
      const characterIds = isClosing ? [] : ["character-main"];
      return {
        id: `shot-${String(index).padStart(2, "0")}`,
        index,
        durationSec,
        goal: isClosing ? "完成品牌记忆和行动召唤" : isHero ? "呈现核心状态转变" : `推进广告叙事第 ${index} 段`,
        visualDescription: `具体描述镜头 ${index} 的人物、产品、环境、光线、构图和动作；承接前一镜头状态并为后一镜头建立自然转场；画面内不生成文字。`,
        cameraAngle: "中景或产品近景",
        cameraMovement: isHero ? "缓慢推进，轻微横移，光线自然变化" : "稳定推进或轻微横移",
        subtitle: isClosing ? "即刻开启轻负担" : `镜头${index}字幕`,
        imagePromptCn: `详细中文关键帧提示词：这是 ${shotCount} 个镜头中的第 ${index} 镜，时长 ${durationSec} 秒；包含场景、主体、真实产品一致性、光线、构图、前后镜头衔接和安全约束；画面无任何可读文字。`,
        imagePromptEn: `Shot ${index} of ${shotCount}, ${durationSec} seconds. Detailed advertising keyframe prompt with scene, subject, lighting, composition, continuity and product consistency; no readable text.`,
        videoPromptCn: isHero
          ? `基于主镜头关键帧和真实产品参考图生成 ${durationSec} 秒视频：${opening.startSec}–${opening.endSec} 秒建立产品，${development.startSec}–${development.endSec} 秒缓慢推进或轻微横移，${closing.startSec}–${closing.endSec} 秒稳定主体并完成光线变化；保持包装结构、材质、颜色和比例，不新增人物，不生成文字。`
          : `该 ${durationSec} 秒镜头使用关键帧配合 Remotion 动效，不要求生成独立视频。`,
        recommendedModel: isHero ? "happyhorse-1.0-r2v" : isClosing ? "remotion" : "qwen-image",
        fallbackPlan: "模型不可用时使用关键帧与 Remotion 图片动效完成。",
        continuityGroupId,
        sceneGroupId: continuityGroupId,
        sceneId: `scene-${continuityGroupId}`,
        generationMode: isHero ? "r2v" : "remotion-motion",
        characterIds,
        productIds: ["product-master"],
        referenceImageAssetIds: [],
        referenceVideoAssetIds: [],
        sceneStateBefore: {
          shotId: `shot-${String(index).padStart(2, "0")}`,
          characterStates: characterIds.map((characterId) => ({ characterId, wardrobeState: "保持人物 Master 造型" })),
          productStates: [{ productId: "product-master", orientation: "继承上一镜产品朝向" }],
          propStates: []
        },
        sceneStateAfter: {
          shotId: `shot-${String(index).padStart(2, "0")}`,
          characterStates: characterIds.map((characterId) => ({ characterId, wardrobeState: "保持人物 Master 造型" })),
          productStates: [{ productId: "product-master", orientation: "作为下一镜连续性起点" }],
          propStates: []
        },
        continuityConstraints: ["产品外观不得变化", "同组人物、服装、场景与主要道具保持一致", "上一镜只作辅助参考", "画面不得生成可读文字"],
        shotDirection: ["一个核心动作", "一个主要镜头运动"],
        motionComplexityScore: 4,
        textSafeZone: isClosing ? "top-center" : "bottom-left",
        videoPromptEn: `One primary action and one camera move. Preserve master references. ${NO_READABLE_TEXT_EN}`,
        negativePromptCn: NO_READABLE_TEXT_CN,
        negativePromptEn: NO_READABLE_TEXT_EN
      };
    }),
    videoGenerationStrategy: {
      heroShotIndex: heroIndex + 1,
      realVideoShots: 1,
      nonHeroShotPlan: "非主镜头使用 Qwen-Image 关键帧与 Remotion 图片动效。",
      fallbackPlan: "主镜头视频失败时，全片降级为关键帧动效。"
    }
  };

  return `你是短视频广告分镜导演。请根据商品简报和广告策略生成完整分镜。

只输出合法 json，不要输出 Markdown、解释、注释或代码围栏。所有面向用户的字段必须使用简体中文。

商品简报：
${JSON.stringify(textBriefForPrompt(brief), null, 2)}

广告策略：
${JSON.stringify(strategy, null, 2)}

硬性要求：
- 当前广告画幅为 ${brief.aspectRatio}，目标平台为 ${brief.platform}。
- 请精确输出 ${shotCount} 个镜头，不多输出、不少输出；index 必须从 1 连续递增到 ${shotCount}。
- durationSec 必须依次原样使用 ${durations.join("、")}，不得自行修改用户设置的时长，总时长为 ${timeline.totalDurationSec} 秒。
- 每个镜头时长必须为 3–8 秒，并共同构成完整叙事。
- 每个镜头都要明确当前镜头序号、当前镜头时长、前一镜头状态与后一镜头衔接目标。
- 为每个镜头输出 continuityGroupId、sceneGroupId、sceneId、sceneStateBefore、sceneStateAfter、continuityConstraints 与 shotDirection。
- 同一 continuityGroupId 必须复用同一人物、产品、场景、服装、主要道具、主光方向和综合色调。
- Scene State 必须继承人物位置与左右手、产品位置与朝向、开合和液位、主要道具位置；没有剧情依据不得重置。
- generationMode 是系统规划元数据，不改变当前 Provider：主镜头使用 r2v，静态产品、结尾和低风险镜头使用 remotion-motion。
- motionComplexityScore 必须为 0–6；每镜最多一个主要人物、一个主要产品、一个核心动作、一个镜头运动和一个状态变化。
- textSafeZone 只能是 top-left、top-center、bottom-left、none，并在画面中保留干净低细节区域。
- 默认主镜头为第 ${heroIndex + 1} 镜，主镜头时长 ${durations[heroIndex]} 秒；全片只规划 1 个 HappyHorse 视频镜头。
- 最后一个镜头承担 CTA，停留 ${durations.at(-1)} 秒。
- 每条字幕不超过 16 个中文字符。
- 每个 imagePromptCn、imagePromptEn 和 videoPromptCn 都必须具体、详细、可执行。
- recommendedModel 只能是：${allowedModels.join("、")}。
- 非主镜头必须适合 Qwen-Image 关键帧加 Remotion 图片动效。
- 禁止明星肖像、影视/动漫/游戏 IP、竞品 Logo、虚假功效、医疗或金融夸大承诺。
${productImageReferenceNote(brief)}
- 每个图片与视频提示词都必须包含以下无文字约束：
${NO_READABLE_TEXT_CN}
${NO_READABLE_TEXT_EN}
- 字幕、标题、卖点和 CTA 只作为 Remotion 后期叠加元数据，不得进入 Qwen-Image 或 HappyHorse 的画面像素。
- 价格、折扣、功效数字、认证、排名与百分比只能引用 verifiedClaims：${JSON.stringify(brief.verifiedClaims ?? [])}；不得自行发明。

目标 JSON 示例：
${JSON.stringify(example, null, 2)}`;
}
