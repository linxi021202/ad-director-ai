import { appendNoReadableTextRules } from "@/lib/prompts/noReadableText";
import { appendSingleFrameConstraint } from "@/lib/prompts/singleComposition";
import type { CharacterAnchorBrief, SceneVisualSpec } from "@/lib/schemas/project";

export const VISUAL_ANCHOR_NEGATIVE_PROMPT = [
  "multiple people",
  "group portrait",
  "split screen",
  "multi-panel",
  "collage",
  "diptych",
  "triptych",
  "storyboard",
  "contact sheet",
  "picture-in-picture",
  "readable text",
  "letters",
  "numbers",
  "logo",
  "watermark",
  "product package"
].join(", ");

export function buildCharacterCandidatePrompt(brief: CharacterAnchorBrief, candidateIndex: number) {
  return appendNoReadableTextRules(appendSingleFrameConstraint([
    `Character Casting Candidate ${candidateIndex}.`,
    "生成一个且只能一个独立人物候选，不得出现第二个人、群像、人物对比、拼图或多视图。",
    "商业广告选角参考照，平视，四分之三角度上半身，脸部无遮挡，完整显示发型、服装和配饰，背景干净中性。",
    `角色：${brief.role}；年龄观感：${brief.apparentAgeRange}；脸部：${brief.faceAppearance}。`,
    `发型：${brief.hairstyle}；发色：${brief.hairColor}；肤色：${brief.skinTone}；体型：${brief.bodyBuild}。`,
    `服装：${brief.wardrobe}；配饰：${brief.accessories.join("、") || "无"}。`,
    `必须保持的身份特征：${brief.immutableTraits.join("；")}。`,
    "本图只建立 Identity，不表现多个剧情时刻；状态变化将在后续镜头中通过同一个人的表情和姿态完成。",
    "画面不得出现产品、包装、品牌、字幕、标题、数字、标牌或任何可读文字。"
  ].join("\n")));
}

export function buildSceneCandidatePrompt(spec: SceneVisualSpec, candidateIndex: number) {
  const states = spec.states?.map((state) => `${state.label}: ${state.lighting}, ${state.mood}`).join("；") ?? spec.timeOfDay;
  const layout = spec.layout?.anchors.map((anchor) => `${anchor.id}=${anchor.semanticPosition}`).join("；") ?? "保持主要空间关系稳定";
  return appendNoReadableTextRules(appendSingleFrameConstraint([
    `Scene Development Candidate ${candidateIndex}.`,
    "生成一个且只能一个完整空场候选，不得出现分屏、拼图、多视图、多个时刻或 Storyboard。",
    `场景身份：${spec.name}；空间结构：${spec.architecture}。`,
    `家具：${spec.furniture.join("、") || "保持简洁"}；主要道具：${spec.heroProps.join("、") || "无"}。`,
    `固定空间锚点：${layout}。这些相对位置属于 Scene Identity，不得随意交换。`,
    `状态计划：${states}。候选只选择一个中性基础状态，同一空间后续仅允许改变光线、天气、情绪和小道具状态。`,
    `主光：${spec.lightingDirection}；光质：${spec.lightingQuality}；色板：${spec.palette.join("、")}。`,
    `必须保持：${spec.immutableTraits.join("；")}。`,
    "不得出现人物、产品、包装、品牌、字幕、标题、数字、屏幕内容、招牌或任何可读文字。"
  ].join("\n")));
}
