import { coldBrewDemo } from "../mock/coldBrewDemo";
import { getDefaultHeroShotArrayIndex, resolveShotPlan } from "../video/shotConfig";
import type { ProductBrief, StoryboardShot } from "../schemas/project";
import type { ProviderRequestContext, TextProvider } from "./types";

function mockMeta() {
  return {
    provider: "mockTextProvider",
    model: "coldBrewDemo",
    costEstimate: 0,
    latencyEstimate: "mock",
    error: null
  };
}

function mockShotsForBrief(brief: ProductBrief, context?: ProviderRequestContext): StoryboardShot[] {
  const timeline = resolveShotPlan(
    context?.requestedShotCount,
    context?.shotDurationPlan,
    context?.targetDurationSec ?? (context?.shotDurationPlan ? undefined : brief.durationSec)
  );
  const heroIndex = getDefaultHeroShotArrayIndex(timeline.shotCount);
  return timeline.shotDurationPlan.map((durationSec, zeroBasedIndex) => {
    const source = coldBrewDemo.shots[zeroBasedIndex % coldBrewDemo.shots.length]!;
    const index = zeroBasedIndex + 1;
    return {
      ...source,
      id: `shot-${String(index).padStart(2, "0")}-mock`,
      index,
      durationSec,
      goal: zeroBasedIndex === timeline.shotCount - 1
        ? "完成品牌记忆和行动召唤"
        : zeroBasedIndex === heroIndex
          ? "呈现核心状态转变"
          : `推进广告叙事第 ${index} 段`,
      imagePromptCn: `${source.imagePromptCn} 当前为第 ${index}/${timeline.shotCount} 镜，时长 ${durationSec} 秒。`,
      imagePromptEn: `${source.imagePromptEn} Shot ${index} of ${timeline.shotCount}, ${durationSec} seconds.`,
      videoPromptCn: zeroBasedIndex === heroIndex
        ? `基于主镜头关键帧和真实产品参考图生成 ${durationSec} 秒广告视频；保持包装、主体构图与画面一致，不生成任何文字。`
        : `该 ${durationSec} 秒镜头使用 Qwen-Image 关键帧与 Remotion 动效完成。`,
      recommendedModel: zeroBasedIndex === heroIndex
        ? "wan2.7-r2v"
        : zeroBasedIndex === timeline.shotCount - 1
          ? "remotion"
          : "qwen-image"
    };
  });
}

export const mockTextProvider: TextProvider = {
  provider: "MockTextProvider",
  async generateStrategy() {
    return { success: true, data: coldBrewDemo.strategy, ...mockMeta() };
  },
  async generateStoryboard(brief, _strategy, context) {
    return { success: true, data: mockShotsForBrief(brief, context), ...mockMeta() };
  },
  async optimizeCopy(storyboard) {
    return {
      success: true,
      data: storyboard.map((shot) => ({ shotId: shot.id, subtitle: shot.subtitle })),
      ...mockMeta()
    };
  },
  async generatePrompts(_brief, _strategy, shots) {
    return { success: true, data: shots, ...mockMeta() };
  },
  async scoreAdPlan() {
    return {
      success: true,
      data: {
        overallScore: 86,
        summary: "Mock score from coldBrewDemo fallback.",
        fallbackReady: true,
        projectId: coldBrewDemo.id
      },
      ...mockMeta()
    };
  }
};
