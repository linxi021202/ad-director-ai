import type { ImageProvider } from "./types";
import { selectProviderModel } from "./providerRouter";

export const mockImageProvider: ImageProvider = {
  provider: "MockImageProvider",
  async generateImage(prompt, options) {
    const route = selectProviderModel({
      taskType: "image",
      costMode: options.costMode,
      qualityMode: options.qualityMode,
      hasChineseText: options.hasChineseText
    });

    return {
      success: true,
      data: {
        imageUrl: `/mock/generated/qwen-image-2.0-${options.aspectRatio.replace(":", "x")}.png`,
        prompt
      },
      provider: route.provider,
      model: route.model,
      costEstimate: route.costEstimate,
      latencyEstimate: route.latencyEstimate,
      error: null
    };
  }
};