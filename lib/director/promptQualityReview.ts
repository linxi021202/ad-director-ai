import type { DetailedFramePrompt, DetailedShotPromptPackage } from "@/lib/schemas/project";
import type { PromptQualityIssue } from "../ai/contracts/detailedPrompts";

export type PromptQualityReview = {
  passed: boolean;
  issues: string[];
  qualityIssues: PromptQualityIssue[];
};

export function validateImagePromptQuality(frame: DetailedFramePrompt): PromptQualityIssue[] {
  const issues: PromptQualityIssue[] = [];
  const add = (path: string, code: string, reason: string, suggestion: string) => issues.push({ path, code, reason, suggestion });
  if (!frame.imagePromptCn.includes("单一完整")) add("imagePromptCn", "SINGLE_FRAME_REQUIRED", "缺少单帧构图约束", "明确单一完整摄影画面，不得拼贴或多面板");
  if (!frame.imagePromptCn.includes("可读文字")) add("imagePromptCn", "ZERO_TEXT_REQUIRED", "缺少零生成文字约束", "明确禁止画面出现任何可读文字、字幕、界面和水印");
  if (/^(?:单一完整摄影画面[，,。\s]*禁止(?:任何)?可读文字[。\s]*|(?:画得好看|生成图片|同上|待定)[。\s]*)$/.test(frame.imagePromptCn.trim())) {
    add("imagePromptCn", "IMAGE_CONTENT_MISSING", "只有通用限制，没有当前帧画面内容", "写出当前时刻的人物、产品、场景、摄影与独有动作状态，不按字符数扩写");
  }
  // Semantic slots are reviewed from the canonical frame, not a prose word-count gate.
  for (const key of ["frozenMoment", "subject", "characterPose", "productPosition", "environment", "cameraAngle", "composition", "keyLight", "depthOfField", "atmosphere", "continuityConstraints"] as const) {
    const value = frame[key];
    const text = Array.isArray(value) ? value.join("；") : value;
    if (!text.trim() || /^(?:同上|默认|待定|适当|合理|无|暂无|描述|内容)[。\s]*$/.test(text.trim())) {
      add(key, "IMAGE_SEMANTIC_SLOT_MISSING", "缺少当前帧可执行语义", "补充该字段的具体状态，保持其它字段和时间锚点不变");
    }
  }
  return issues;
}

/** PASS D: deterministic review after DeepSeek's own scoring and before persistence. */
export function reviewDetailedPromptPackage(value: DetailedShotPromptPackage): PromptQualityReview {
  const qualityIssues: PromptQualityIssue[] = [];
  const add = (path: string, code: string, reason: string, suggestion: string) => qualityIssues.push({ path, code, reason, suggestion });
  const scores = value.qualityScores;

  for (const key of ["creativeDepth", "visualSpecificity", "actionExecutability"] as const) {
    if (scores[key] < 8) add(`qualityScores.${key}`, "LOW_QUALITY_SCORE", "导演质量评分低于 8 分", "核对导演信息并仅修复对应缺项，不得只抬高分数");
  }
  for (const [key, maximum] of [["textRisk", 2], ["deformationRisk", 3]] as const) {
    if (scores[key] > maximum) add(`qualityScores.${key}`, "HIGH_RISK_SCORE", "生成风险评分超出允许范围", "完善对应限制条件后重新评估风险");
  }

  for (const [index, frame] of value.framePrompts.entries()) {
    const prefix = `framePrompts[${index}]`;
    for (const key of ["cameraHeight", "cameraAngle", "focalLength", "composition", "keyLight", "materialDetails", "handState", "productPosition", "frozenMoment"] as const) {
      if (/^(?:保持一致|按需调整|适当|合理|待定|同上|默认|无|暂无|推进|自然|不变)[。.!！\s]*$/.test(frame[key].trim()) || /^(?:描述|细节|信息|内容)[。.!！\s]*$/.test(frame[key].trim())) {
        add(`${prefix}.${key}`, "TOO_GENERIC", "仅有占位或泛化描述，缺少可执行信息", "补充该字段对应的具体位置、方向、状态或参数，保留其它字段和时间锚点");
      }
    }
    if (!qualityIssues.some((issue) => issue.path === `${prefix}.cameraAngle`)
      && !/低|高|平|俯|仰|侧|正|顶|背|斜|水平|角度|eye|low|high|level|angle|front|side|overhead|tilt/i.test(frame.cameraAngle)) {
      add(`${prefix}.cameraAngle`, "CAMERA_ANGLE_UNCLEAR", "没有明确可执行的拍摄方向", "说明平视、俯拍、仰拍或侧面方向；无需为了字符数扩写");
    }
    for (const issue of validateImagePromptQuality(frame)) {
      if (!qualityIssues.some((existing) => existing.path === `${prefix}.${issue.path}`)) qualityIssues.push({ ...issue, path: `${prefix}.${issue.path}` });
    }
  }

  if (!/Start State|开始状态/i.test(value.videoPromptCn)) add("videoPromptCn", "START_STATE_REQUIRED", "视频提示词缺少开始状态", "补充明确的起始人物、产品和场景状态");
  if (!/End State|结束状态/i.test(value.videoPromptCn)) add("videoPromptCn", "END_STATE_REQUIRED", "视频提示词缺少结束状态", "补充明确的结束人物、产品和场景状态");
  if (!/[0-9]+(?:\.[0-9]+)?s/i.test(value.videoPromptCn)) add("videoPromptCn", "TIMELINE_REQUIRED", "视频提示词缺少时间轴", "保留镜头时长并分段标明动作时间");

  return { passed: qualityIssues.length === 0, qualityIssues, issues: qualityIssues.map((issue) => `${issue.path}：${issue.reason}`) };
}
