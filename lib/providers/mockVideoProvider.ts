import type { VideoProvider } from "./types";
import { selectProviderModel } from "./providerRouter";

export const mockVideoProvider: VideoProvider = {
  provider: "MockVideoProvider",
  async generateVideo(prompt, imageUrl, options) {
    const route = selectProviderModel({
      taskType: "video",
      costMode: options.costMode,
      qualityMode: options.qualityMode,
      isHeroShot: options.isHeroShot
    });

    return {
      success: true,
      data: {
        taskId: `mock-video-task-${route.model}`,
        videoUrl: `/mock/generated/${route.model}-${options.durationSec}s-${options.aspectRatio.replace(":", "x")}.mp4`,
        status: "completed"
      },
      provider: route.provider,
      model: route.model,
      costEstimate: route.costEstimate,
      latencyEstimate: route.latencyEstimate,
      error: null
    };
  }
};