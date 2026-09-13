import type {
  AdStrategy,
  ProductBrief,
  ProductVisualSpec,
  ReferencePack,
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
