import "server-only";

import { z } from "zod";
import type { CharacterAnchorBrief, CharacterCandidateDirection, SceneCandidateDirection, SceneVisualSpec } from "@/lib/schemas/project";
import { readPrivateVisualAssetDataUrl } from "@/lib/image/productReference";
import { callVisualInspector } from "@/lib/visual/visualInspector";

export function fallbackCharacterDirections(brief: CharacterAnchorBrief): CharacterCandidateDirection[] {
  return [
    { title: "清晰理性型", castingPositioning: `可信、克制的${brief.role}`, ageTexture: "干净利落的成熟质感", faceStructure: "偏长脸，清晰下颌线", facialFeatures: "细长眼型、直鼻梁、克制表情", hairstyle: "利落短发或低层次轮廓", wardrobeMood: "结构化、低饱和、专业", bodyLanguage: "肩背挺直，动作精确", differentiation: "以锐利骨相和理性气质建立识别", continuityStability: "固定发型轮廓、下颌线和服装结构", recommendationReason: "商业可信度与跨镜头稳定性最高" },
    { title: "亲和生活型", castingPositioning: `自然、有温度的${brief.role}`, ageTexture: "轻熟而有生活感", faceStructure: "柔和圆方脸，面部线条饱满", facialFeatures: "圆润眼型、自然眉形、轻微笑意", hairstyle: "柔软中短发，轮廓蓬松", wardrobeMood: "舒适、柔和、有日常质感", bodyLanguage: "姿态放松，微微前倾", differentiation: "以柔和脸型和亲和状态区别于理性方案", continuityStability: "固定面部圆润度、发际线和衣领特征", recommendationReason: "更适合生活化共鸣" },
    { title: "鲜明行动型", castingPositioning: `有驱动力、记忆点强的${brief.role}`, ageTexture: "年轻锐气与轻运动感", faceStructure: "偏方脸，颧骨与眉骨更明确", facialFeatures: "浓眉、明亮眼神、嘴角线条明确", hairstyle: "短而有方向感的纹理发型", wardrobeMood: "简洁机能感，明快但无品牌", bodyLanguage: "重心前置，动作开放有力", differentiation: "以强轮廓、动态姿态和机能气质形成第三极", continuityStability: "固定眉骨、发型走向和服装色块", recommendationReason: "画面识别度与行动叙事最强" }
  ];
}

export function fallbackSceneDirections(spec: SceneVisualSpec): SceneCandidateDirection[] {
  return [
    { title: "轴线秩序", spatialConcept: `${spec.name}采用清晰中轴与对称功能分区`, cameraPosition: "入口正向平视机位", depthStructure: "前景留白、中景功能区、背景结构墙", dominantMaterials: "哑光硬质材料与少量玻璃", heroPropArrangement: "核心道具沿中轴集中排列", lightingDesign: "侧前方大面积柔光，结构边缘清晰", differentiation: "秩序、对称、稳定的空间解法", continuityStability: "固定中轴、入口和背景结构关系", recommendationReason: "最利于连续性与商品展示" },
    { title: "斜向纵深", spatialConcept: `${spec.name}采用对角动线和深景透视`, cameraPosition: "空间一角的斜向广角机位", depthStructure: "近景遮挡、中景行动区、远景透视出口", dominantMaterials: "温润木质与细密织物", heroPropArrangement: "核心道具沿斜向动线分层布置", lightingDesign: "侧后方切入的方向光形成纵深", differentiation: "斜线构图和强透视区别于中轴方案", continuityStability: "固定消失点、主要动线和远景出口", recommendationReason: "更适合动作调度和空间推进" },
    { title: "环抱焦点", spatialConcept: `${spec.name}采用围合布局，将功能焦点置于偏心区域`, cameraPosition: "低位侧向中焦机位", depthStructure: "两侧框景、中央活动层、后方柔化环境层", dominantMaterials: "金属细节与低反射石材", heroPropArrangement: "核心道具形成半环并留出人物行动口", lightingDesign: "顶部柔光配局部轮廓光", differentiation: "围合、偏心、低机位形成独立空间性格", continuityStability: "固定框景边界、焦点位置和行动开口", recommendationReason: "视觉记忆点与情绪包裹感最强" }
  ];
}

const diversitySchema = z.object({
  passed: z.boolean(),
  tooSimilarIndexes: z.array(z.number().int().min(1).max(3)).max(2),
  summary: z.string().min(1)
}).strict();

export async function inspectCandidateDiversity(input: {
  kind: "character" | "scene";
  assetIds: string[];
  sessionId: string;
  projectId: string;
}) {
  if (input.assetIds.length < 3) return { passed: true, tooSimilarIndexes: [], summary: "成功候选不足三张，跳过三案比较。" };
  try {
    const images = await Promise.all(input.assetIds.map((assetId) => readPrivateVisualAssetDataUrl(assetId, input)));
    const subject = input.kind === "character" ? "人物身份（脸型、五官、发型、年龄质感、服装气质）" : "空间方案（拓扑、机位、景深、材质、道具布局、光线）";
    const result = await callVisualInspector({
      sessionId: input.sessionId,
      images,
      schema: diversitySchema,
      prompt: `依次比较三张候选图的${subject}。它们应服务同一功能但必须一眼可区分。若两张近似复刻，只把更弱、需要重生的图片序号写入 tooSimilarIndexes，最多 2 个。可读文字或拼图也判定该图需重生。只输出 {"passed":boolean,"tooSimilarIndexes":[1|2|3],"summary":"中文结论"}。`
    });
    return result.success && result.data ? result.data : { passed: true, tooSimilarIndexes: [], summary: "视觉多样性检查暂时不可用，保留已生成候选。" };
  } catch {
    return { passed: true, tooSimilarIndexes: [], summary: "视觉多样性检查暂时不可用，保留已生成候选。" };
  }
}
