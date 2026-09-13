import type { DetailedShotPromptPackage } from "@/lib/schemas/project";

export type PromptQualityReview = {
  passed: boolean;
  issues: string[];
};

/** PASS D: deterministic review after DeepSeek's own scoring and before persistence. */
export function reviewDetailedPromptPackage(value: DetailedShotPromptPackage): PromptQualityReview {
  const issues: string[] = [];
  const scores = value.qualityScores;

  if (scores.creativeDepth < 8) issues.push("创意深度低于 8 分");
  if (scores.visualSpecificity < 8) issues.push("视觉具体度低于 8 分");
  if (scores.actionExecutability < 8) issues.push("动作可执行性低于 8 分");
  if (scores.textRisk > 2) issues.push("生成文字风险高于 2 分");
  if (scores.deformationRisk > 3) issues.push("形变风险高于 3 分");

  for (const [index, frame] of value.framePrompts.entries()) {
    const label = `画面 ${index + 1}`;
    if (frame.imagePromptCn.length < 400) issues.push(`${label}中文图片提示词不足 400 字符`);
    if (!frame.imagePromptCn.includes("单一完整")) issues.push(`${label}缺少单帧构图约束`);
    if (!frame.imagePromptCn.includes("可读文字")) issues.push(`${label}缺少零生成文字约束`);
    if (frame.continuityConstraints.length < 3) issues.push(`${label}连续性约束不足`);
  }

  if (!/Start State|开始状态/i.test(value.videoPromptCn)) issues.push("视频提示词缺少开始状态");
  if (!/End State|结束状态/i.test(value.videoPromptCn)) issues.push("视频提示词缺少结束状态");
  if (!/[0-9]+(?:\.[0-9]+)?s/i.test(value.videoPromptCn)) issues.push("视频提示词缺少时间轴");

  return { passed: issues.length === 0, issues };
}
