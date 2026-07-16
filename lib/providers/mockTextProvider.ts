import { coldBrewDemo } from "../mock/coldBrewDemo";
import type { TextProvider } from "./types";

function mockMeta() {
  return {
    provider: "mockTextProvider",
    model: "coldBrewDemo",
    costEstimate: 0,
    latencyEstimate: "mock",
    error: null
  };
}

export const mockTextProvider: TextProvider = {
  provider: "MockTextProvider",
  async generateStrategy() {
    return {
      success: true,
      data: coldBrewDemo.strategy,
      ...mockMeta()
    };
  },
  async generateStoryboard() {
    return {
      success: true,
      data: coldBrewDemo.shots,
      ...mockMeta()
    };
  },
  async optimizeCopy(storyboard) {
    return {
      success: true,
      data: storyboard.map((shot) => ({
        shotId: shot.id,
        subtitle: shot.subtitle
      })),
      ...mockMeta()
    };
  },
  async generatePrompts() {
    return {
      success: true,
      data: coldBrewDemo.shots,
      ...mockMeta()
    };
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
