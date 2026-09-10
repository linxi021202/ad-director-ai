import { productImageReferenceNote, textBriefForPrompt } from "./briefForPrompt";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "./noReadableText";
import type { AdStrategy, ProductBrief, ProductVisualSpec } from "../schemas/project";
import { getDefaultHeroShotArrayIndex, resolveShotPlan } from "../video/shotConfig";
import { SINGLE_FRAME_HARD_CONSTRAINT_CN, SINGLE_VIDEO_HARD_CONSTRAINT_CN } from "./singleComposition";
import { serializeProductVisualSpecForPrompt } from "../visual/productVisualSpec";

const allowedModels = ["deepseek-v4-pro", "qwen-image", "wan2.7-i2v", "remotion"];
type ShotPlanInput = { requestedShotCount?: number; targetDurationSec?: number; shotDurationPlan?: number[]; productVisualSpec?: ProductVisualSpec };

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
      const continuityGroupId = isClosing ? "ending" : isHero ? "product-world" : "narrative-main";
      const characterIds = isClosing ? [] : ["character-main"];
      const shotId = `shot-${String(index).padStart(2, "0")}`;
      const frameCount = ({ 3: 2, 4: 3, 5: 4, 6: 4, 7: 5, 8: 5 } as Record<number, number>)[durationSec] ?? 3;
      const beatCount = Math.max(2, Math.min(8, durationSec));
      const subclipCount = durationSec >= 7 ? 2 : 1;
      return {
        id: shotId,
        index,
        durationSec,
        goal: isClosing ? "完成品牌记忆和行动召唤" : isHero ? "呈现核心状态转变" : `推进广告叙事第 ${index} 段`,
        visualDescription: `具体描述镜头 ${index} 的人物、产品、环境、光线、构图和动作；承接前一镜头状态并为后一镜头建立自然转场；画面内不生成文字。`,
        cameraAngle: "中景或产品近景",
        cameraMovement: isHero ? "围绕主体完成一次连续推近" : "一次连续且克制的运镜",
        subtitle: isClosing ? "即刻开启轻负担" : `镜头${index}字幕`,
        imagePromptCn: `详细中文关键帧提示词：这是 ${shotCount} 个镜头中的第 ${index} 镜，时长 ${durationSec} 秒；包含场景、主体、真实产品一致性、光线、构图、前后镜头衔接和安全约束；画面无任何可读文字。`,
        imagePromptEn: `Shot ${index} of ${shotCount}, ${durationSec} seconds. Detailed advertising keyframe prompt with scene, subject, lighting, composition, continuity and product consistency; no readable text.`,
        videoPromptCn: isHero
          ? `基于独立完整的首帧（可选独立尾帧）生成 ${durationSec} 秒连续视频；同一时空内按秒点完成简单微动作链与一条连续运镜；保持包装结构、材质、颜色和比例，不新增人物，不生成文字。${SINGLE_VIDEO_HARD_CONSTRAINT_CN}`
          : `该 ${durationSec} 秒镜头使用关键帧配合 Remotion 动效，不要求生成独立视频。`,
        recommendedModel: isHero ? "wan2.7-i2v" : isClosing ? "remotion" : "qwen-image",
        fallbackPlan: "模型不可用时使用关键帧与 Remotion 图片动效完成。",
        continuityGroupId,
        sceneGroupId: continuityGroupId,
        sceneId: `scene-${continuityGroupId}`,
        generationMode: isHero ? "i2v" : "remotion-motion",
        characterIds,
        productIds: ["product-master"],
        containsProduct: true,
        productFidelityMode: "exact",
        productShotType: isClosing ? "packshot" : isHero ? "human-product-interaction" : "product-in-scene",
        exactProductShot: isClosing,
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
        shotDirection: ["按时序完成简单微动作链", "一条连续运镜", "产品状态保持稳定"],
        motionComplexityScore: 5,
        textSafeZone: isClosing ? "top-center" : "bottom-left",
        videoPromptEn: `Animate independent full-frame boundary images as one continuous shot with timed simple micro-actions and one continuous camera path. No cuts, split screen, collage, montage, or multi-panel layout. Preserve master references. ${NO_READABLE_TEXT_EN}`,
        negativePromptCn: NO_READABLE_TEXT_CN,
        negativePromptEn: NO_READABLE_TEXT_EN,
        frames: Array.from({ length: frameCount }, (_, frameIndex) => ({
          id: `${shotId}-frame-${frameIndex + 1}`, shotId, index: frameIndex,
          role: frameIndex === 0 ? "start" : frameIndex === frameCount - 1 ? "end" : frameIndex === Math.floor(frameCount / 2) ? "product" : "action",
          timestampSec: Number((durationSec * frameIndex / Math.max(1, frameCount - 1)).toFixed(2)),
          description: `镜头 ${index} 在第 ${frameIndex + 1} 个时间锚点的单一冻结状态`,
          imagePromptCn: `镜头 ${index} 第 ${frameIndex + 1} 帧，只描述一个冻结瞬间和一个完整画面，禁止拼贴、分屏与连续动作同画布。${NO_READABLE_TEXT_CN}`,
          imagePromptEn: `Shot ${index}, frame ${frameIndex + 1}: one frozen moment, one full-frame image only, no collage, panels, or action sequence. ${NO_READABLE_TEXT_EN}`,
          negativePromptCn: "拼贴，分屏，多面板，故事板，接触表，同屏多个时刻",
          negativePromptEn: "collage, split screen, multi-panel, storyboard, contact sheet, simultaneous moments",
          status: "pending", isLocked: false
        })),
        microBeats: Array.from({ length: beatCount }, (_, beatIndex) => ({
          id: `${shotId}-beat-${beatIndex + 1}`, shotId, index: beatIndex,
          purpose: beatIndex === 0 ? "orient" : beatIndex === beatCount - 1 ? "resolve" : beatIndex === Math.floor(beatCount / 2) ? "demonstrate" : "emphasize",
          startSec: Number((durationSec * beatIndex / beatCount).toFixed(2)),
          endSec: Number((durationSec * (beatIndex + 1) / beatCount).toFixed(2)),
          action: `只执行第 ${beatIndex + 1} 个简单可见微动作`,
          stateChange: `从时间锚点 ${beatIndex + 1} 推进到下一状态`,
          complexity: beatIndex === 0 || beatIndex === beatCount - 1 ? 1 : 2,
          frameId: `${shotId}-frame-${Math.min(frameCount, Math.floor(beatIndex * frameCount / beatCount) + 1)}`
        })),
        subclips: Array.from({ length: subclipCount }, (_, clipIndex) => ({
          id: `${shotId}-subclip-${clipIndex + 1}`, shotId, index: clipIndex,
          startSec: Number((durationSec * clipIndex / subclipCount).toFixed(2)),
          durationSec: Number((durationSec / subclipCount).toFixed(2)),
          startFrameId: `${shotId}-frame-${clipIndex === 0 ? 1 : Math.ceil(frameCount / 2)}`,
          endFrameId: `${shotId}-frame-${clipIndex === subclipCount - 1 ? frameCount : Math.ceil(frameCount / 2)}`,
          status: "pending"
        })),
        narrativeProgression: {
          previousState: `镜头 ${index} 开始前的已知状态`,
          newInformation: isClosing ? "品牌行动信息" : `镜头 ${index} 提供的新信息`,
          resultingState: `镜头 ${index} 完成后的明确状态`
        }
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

${serializeProductVisualSpecForPrompt(input.productVisualSpec)}

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
- 每个镜头必须输出 containsProduct。画面中出现、使用、手持、摆放或特写产品时为 true；否则为 false。
- containsProduct=true 的镜头 productFidelityMode 必须为 exact，真实 Product Master 是最高事实来源。productShotType 必须是 packshot、product-in-scene 或 human-product-interaction。
- Packshot、Ending、CTA、产品特写不得让生成模型重画产品；Product In Scene 必须先设计无产品留位背景，再合成真实产品；人物产品交互只能设计简单低风险动作。
- ProductVisualSpec.containerType 是产品术语唯一来源。不得输出 forbiddenContainerTypes 中的容器词；如果真实产品是 cup，任何字段都不得写瓶、冷萃瓶、饮料瓶、塑料瓶、玻璃瓶、bottle、can 或 carton。
- Scene State 必须继承人物位置与左右手、产品位置与朝向、开合和液位、主要道具位置；没有剧情依据不得重置。
- 夜间与白天必须建模为不同 sceneGroupId/sceneId（例如 office-night、office-day）。切换时必须输出 sceneTransitionReason；人物 Character Master 与服装默认保持不变。
- generationMode 是系统规划元数据，不改变当前 Provider：主镜头使用 i2v，静态产品、结尾和低风险镜头使用 remotion-motion。
- motionComplexityScore 必须为 0–6；每镜最多一个主要人物和一个主要产品；微动作按时间依次发生，并共享一条连续运镜。
- textSafeZone 只能是 top-left、top-center、bottom-left、none，并在画面中保留干净低细节区域。
- 默认主镜头为第 ${heroIndex + 1} 镜，主镜头时长 ${durations[heroIndex]} 秒；全片只规划 1 个 Wan 2.7 I2V 视频镜头。
- 最后一个镜头承担 CTA，停留 ${durations.at(-1)} 秒。
- 每条字幕不超过 16 个中文字符。
- 每个 imagePromptCn、imagePromptEn 和 videoPromptCn 都必须具体、详细、可执行。
- 每个图片提示词必须包含：${SINGLE_FRAME_HARD_CONSTRAINT_CN}
- 相邻镜头的关键帧必须拉开视觉距离：景别、摄影机轴位、人物动作、产品使用阶段中至少两项不同，同时继承同组人物和场景身份。
- 每个 shot 必须包含 frames、microBeats、subclips 和 narrativeProgression。frames 是同一镜头内按时间排序的独立 ShotFrame，不是拼图。
- ShotFrame 数量：3 秒 2 帧；4 秒 3 帧；5 秒 3–4 帧；6 秒 4 帧；7–8 秒 4–5 帧。每帧的中英文图片提示词只描述一个冻结瞬间，并明确 one full-frame image only / 单一完整画面。
- MicroBeat 数量：3 秒 2–4；4 秒 3–5；5 秒 4–6；6 秒 5–7；7 秒 5–8；8 秒 6–9。每个 beat 只允许一个简单动作，complexity 必须为 1–4，时间不得重叠或越界。
- subclips 最多 2 段；narrativeProgression 必须明确 previousState、newInformation、resultingState。
- 主镜头视频允许高密度简单微动作，但必须保持同一时空和一条连续运镜，并包含：${SINGLE_VIDEO_HARD_CONSTRAINT_CN}
- recommendedModel 只能是：${allowedModels.join("、")}。
- 非主镜头必须适合 Qwen-Image 关键帧加 Remotion 图片动效。
- 禁止明星肖像、影视/动漫/游戏 IP、竞品 Logo、虚假功效、医疗或金融夸大承诺。
${productImageReferenceNote(brief)}
- 每个图片与视频提示词都必须包含以下无文字约束：
${NO_READABLE_TEXT_CN}
${NO_READABLE_TEXT_EN}
- 字幕、标题、卖点和 CTA 只作为 Remotion 后期叠加元数据，不得进入 Qwen-Image 或 Wan 的画面像素。
- 不主动设计代码屏幕、新闻网页、菜单、文档文字、便利贴、海报或广告牌；剧情必须出现时指定 blank screen、defocused UI、documents without readable text 或 blank poster。
- 价格、折扣、功效数字、认证、排名与百分比只能引用 verifiedClaims：${JSON.stringify(brief.verifiedClaims ?? [])}；不得自行发明。

目标 JSON 示例：
${JSON.stringify(example, null, 2)}`;
}
