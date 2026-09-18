import type {
  AdStrategy,
  ProductBrief,
  ProductVisualSpec,
  ReferencePack,
  DetailedShotPromptPackage,
  ShotFrame,
  StoryboardShot,
  VisualContinuityBible
} from "../schemas/project";
import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "./noReadableText";
import { SINGLE_FRAME_HARD_CONSTRAINT_CN, SINGLE_VIDEO_HARD_CONSTRAINT_CN } from "./singleComposition";
import { serializeProductVisualSpecForPrompt } from "../visual/productVisualSpec";

export type ShotPromptExpansionInput = {
  brief: ProductBrief;
  strategy: AdStrategy;
  shot: StoryboardShot;
  previousShot?: StoryboardShot;
  productVisualSpec?: ProductVisualSpec;
  visualContinuityBible?: VisualContinuityBible;
  referencePack?: ReferencePack;
};

export function buildShotPromptExpansionPrompt(input: ShotPromptExpansionInput): string {
  const { brief, strategy, shot, previousShot, productVisualSpec, visualContinuityBible, referencePack } = input;
  return `你是资深商业广告导演与摄影提示词工程师。这里是独立 PASS C：只扩写一个镜头的完整 Prompt Package，随后在 PASS D 中进行质量自检。只输出合法 JSON。

广告需求：${JSON.stringify(brief)}
已确认创意：${JSON.stringify(strategy)}
当前详细分镜：${JSON.stringify(shot)}
上一镜结束状态：${JSON.stringify(previousShot?.sceneStateAfter ?? previousShot?.narrativeProgression?.resultingState ?? "广告开场")}
${serializeProductVisualSpecForPrompt(productVisualSpec)}
人物、产品与场景基准：${JSON.stringify(visualContinuityBible ?? {})}
参考资产：${JSON.stringify(referencePack ?? {})}

必须返回 DetailedShotPromptPackage：
- shotId 必须为 ${shot.id}。
- continuityContext 必须具体写 product、character、wardrobe、scene、sceneState、majorProps、previousShotState、immutableElements、allowedChanges，禁止使用“保持一致”代替具体身份。
- directingNotesCn 是完整中文导演说明；directingNotesEn 与其语义一致。
- 每个 framePrompt 只描述一个确定 frozen moment。中文 imagePromptCn 约 400-800 汉字，英文 imagePromptEn 约 250-450 English words。
- 每帧必须明确主体位置、身体方向、表情、视线、双手、产品位置/朝向/比例、前中后景、空间、机位、焦段、光圈、景深、主辅光、实景光、阴影、反射、材质、色彩、气氛、连续性和禁止变化。
- 每个 imagePromptCn 结尾必须包含：这是一张单一完整摄影画面，只描述一个确定时间点。不得把前后动作阶段同时展示在一张图片中。
- videoPromptCn 至少 300 个中文字符，明确 Start State、End State，并用 0.0s-${shot.durationSec.toFixed(1)}s 时间轴写 Hand/Gaze/Body/Product/Camera/Environment Motion；一个时间段只安排少量动作。
- videoPromptEn 与中文完整对应。必须加入手部与产品防变形、禁止新增人物和禁止容器变化。
- 所有图片和视频提示词必须执行零生成文字策略：${NO_READABLE_TEXT_CN} ${NO_READABLE_TEXT_EN}
- 单帧规则：${SINGLE_FRAME_HARD_CONSTRAINT_CN}
- 单视频规则：${SINGLE_VIDEO_HARD_CONSTRAINT_CN}
- 真实产品出现时，必须逐项注入真实产品容器、轮廓、比例、材质、颜色区域、标识所在区域及 forbiddenContainerTypes，不能只写“产品一致”。
- PASS D qualityScores 必须诚实评分 creativeDepth、visualSpecificity、productConsistency、characterContinuity、sceneContinuity、actionExecutability、textRisk、deformationRisk。前三项及 actionExecutability 必须 >=8，textRisk <=2，deformationRisk <=3，否则先自行深化后再返回。
- qaChecklist 至少六项，覆盖单帧、产品、人物、场景、动作、文字和变形风险。
- 禁止用“电影感、高级、质感、氛围感、精致、清爽、科技感”等空泛词替代机位、空间、光线、材质、动作和产品位置。

JSON 字段必须完整，严格使用 detailedShotPromptPackageSchema 对应的字段名称。`;
}

export function buildShotPromptFoundationPrompt(input: ShotPromptExpansionInput, compact = false): string {
  const { brief, strategy, shot, previousShot, productVisualSpec, visualContinuityBible, referencePack } = input;
  return `你是资深商业广告导演。只生成镜头 ${shot.index} 的导演基础包，不生成 framePrompts，不重复逐帧图片提示词。只输出合法 JSON。

广告需求：${JSON.stringify({ productName: brief.productName, audience: brief.targetAudience, sellingPoints: brief.sellingPoints, verifiedClaims: brief.verifiedClaims, aspectRatio: brief.aspectRatio, platform: brief.platform })}
创意策略：${JSON.stringify({ coreMessage: strategy.coreMessage, emotionalArc: strategy.emotionalArc, visualStyle: strategy.visualStyle, pacing: strategy.pacing, cta: strategy.cta })}
当前镜头：${JSON.stringify(compactShotContext(shot))}
上一镜结束状态：${JSON.stringify(previousShot?.sceneStateAfter ?? previousShot?.resultingState ?? "广告开场")}
${serializeProductVisualSpecForPrompt(productVisualSpec)}
连续性基准：${JSON.stringify(visualContinuityBible ?? {})}
参考资产摘要：${JSON.stringify(referencePack ?? {})}

返回字段必须且只能是 shotId、continuityContext、directingNotesCn、directingNotesEn、videoPromptCn、videoPromptEn、negativePromptCn、negativePromptEn、narrationDirection、textSafeZone、qaChecklist、qualityScores。
- shotId 固定为 ${shot.id}。
- continuityContext 具体填写 product、character、wardrobe、scene、sceneState、majorProps、previousShotState、immutableElements、allowedChanges。
- directingNotesCn 至少 120 个中文字符；directingNotesEn 至少 60 个英文字符。
- videoPromptCn 至少 300 个中文字符，包含“开始状态 Start State”“结束状态 End State”和 0.0s-${shot.durationSec.toFixed(1)}s 分段时间轴；videoPromptEn 至少 120 个英文字符。
- qaChecklist 至少六项；qualityScores 包含 creativeDepth、visualSpecificity、productConsistency、characterContinuity、sceneContinuity、actionExecutability、textRisk、deformationRisk。
- creativeDepth、visualSpecificity、productConsistency、characterContinuity、sceneContinuity、actionExecutability 均须不低于 8；textRisk 不高于 2；deformationRisk 不高于 3。
- 所有提示词执行：${NO_READABLE_TEXT_CN} ${NO_READABLE_TEXT_EN}
${compact ? "本次是长度保护重试。保持字段完整，用短句表达，每个事实只写一次。" : "逐帧视觉细节将在后续独立请求中生成，本次不要提前展开。"}`;
}

export function buildSingleFramePromptExpansionPrompt(
  input: ShotPromptExpansionInput,
  frame: ShotFrame,
  foundation: Pick<DetailedShotPromptPackage, "continuityContext" | "directingNotesCn">,
  compact = false
): string {
  const { brief, strategy, shot, productVisualSpec } = input;
  return `你是商业广告关键帧提示词工程师。只生成镜头 ${shot.index} 的第 ${frame.index + 1} 帧，不生成其他帧、视频提示词、评分或导演基础包。只输出一个合法 JSON 对象。

商品与画幅：${JSON.stringify({ productName: brief.productName, aspectRatio: brief.aspectRatio, platform: brief.platform, verifiedClaims: brief.verifiedClaims })}
创意信息：${JSON.stringify({ coreMessage: strategy.coreMessage, emotionalArc: strategy.emotionalArc, visualStyle: strategy.visualStyle, pacing: strategy.pacing })}
镜头结构：${JSON.stringify(compactShotContext(shot))}
当前冻结瞬间：${JSON.stringify({ frameId: frame.id, timestampSec: frame.timestampSec, role: frame.role, description: frame.description })}
导演基础：${JSON.stringify(foundation)}
${serializeProductVisualSpecForPrompt(productVisualSpec)}

字段必须且只能是 frameId、timestampSec、role、frozenMoment、subject、subjectPosition、characterPose、facialExpression、gazeDirection、handState、productPosition、productOrientation、productScale、environment、foreground、middleGround、background、composition、cameraHeight、cameraAngle、lens、focalLength、aperture、depthOfField、lightingDirection、lightingQuality、keyLight、fillLight、practicalLights、shadowBehavior、reflections、materialDetails、colorDesign、atmosphere、spatialDepth、continuityConstraints、forbiddenChanges、imagePromptCn、imagePromptEn、negativePromptCn、negativePromptEn。
- frameId、timestampSec、role 必须分别原样返回 ${JSON.stringify(frame.id)}、${frame.timestampSec}、${JSON.stringify(frame.role)}。
- 只描述 ${frame.timestampSec.toFixed(2)} 秒这一个冻结瞬间，不得包含动作前后两个时刻。
- imagePromptCn ${compact ? "控制在 400-480 个中文字符" : "控制在 400-600 个中文字符"}；imagePromptEn ${compact ? "控制在 120-180 个英文单词" : "控制在 160-240 个英文单词"}。
- imagePromptCn 必须明确包含“单一完整”和“可读文字”，并以单帧约束收尾。
- continuityConstraints 和 forbiddenChanges 各至少三项。
- 不重复背景故事，不输出 Markdown。${SINGLE_FRAME_HARD_CONSTRAINT_CN} ${NO_READABLE_TEXT_CN} ${NO_READABLE_TEXT_EN}`;
}

function compactShotContext(shot: StoryboardShot) {
  return {
    id: shot.id,
    index: shot.index,
    durationSec: shot.durationSec,
    goal: shot.goal,
    visualDescription: shot.visualDescription,
    cameraAngle: shot.cameraAngle,
    cameraMovement: shot.cameraMovement,
    subtitle: shot.subtitle,
    sceneId: shot.sceneId,
    continuityGroupId: shot.continuityGroupId,
    containsProduct: shot.containsProduct,
    productShotType: shot.productShotType,
    sceneStateBefore: shot.sceneStateBefore,
    sceneStateAfter: shot.sceneStateAfter,
    continuityConstraints: shot.continuityConstraints,
    shotDirection: shot.shotDirection
  };
}
