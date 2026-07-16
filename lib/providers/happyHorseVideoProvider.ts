import { getAIConfig } from "../config/ai";
import { resolveProviderApiKey } from "../secrets/resolver";
import { generateHappyHorseVideo } from "../video/happyHorseClient";
import { resolveHappyHorseReferenceImages } from "../video/referenceImages";
import { getHappyHorseCapability } from "./happyHorseCapability";
import type { VideoProvider } from "./types";

const MANUAL_MESSAGE = "HappyHorse 真实调用当前不可用，可改用手动导入视频作为备用路径。";

export const happyHorseVideoProvider: VideoProvider = {
  provider: "happyhorse",
  async generateVideo(prompt, _imageUrl, options) {
    const config = getAIConfig({ allowSessionSecrets: true });
    return {
      success: false,
      data: { taskId: "", videoUrl: "", status: "not-implemented" },
      provider: "happyhorse",
      model: config.video.happyHorseModel,
      costEstimate: 0,
      latencyEstimate: "not-applicable",
      error: `${MANUAL_MESSAGE} 请通过主镜头多参考图生成入口调用。`
    };
  },
  async generateHeroVideoFromImage(input) {
    const config = getAIConfig({ allowSessionSecrets: true });
    const hasKey = Boolean(await resolveProviderApiKey("happyhorse", input.sessionId));
    const apiAvailable = config.realVideoEnabled && hasKey;

    if (!apiAvailable || !input.projectId || !input.shotId) {
      return {
        success: false,
        ...getHappyHorseCapability(true, apiAvailable),
        error: apiAvailable
          ? "缺少项目或镜头参数，无法创建 HappyHorse 视频任务。"
          : MANUAL_MESSAGE
      };
    }

    try {
      const referenceImages = await resolveHappyHorseReferenceImages({
        heroImageUrl: input.imageUrl,
        productImages: input.productImages
      });

      return await generateHappyHorseVideo({
        projectId: input.projectId,
        shotId: input.shotId,
        referenceImages,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        durationSec: input.durationSec,
        sessionId: input.sessionId
      });
    } catch (error) {
      return {
        success: false,
        provider: "dashscope",
        model: config.video.happyHorseModel,
        latencyMs: 0,
        error: error instanceof Error ? error.message : "HappyHorse 参考图准备失败。"
      };
    }
  }
};
