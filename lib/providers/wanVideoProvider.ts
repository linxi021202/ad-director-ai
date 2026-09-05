import { getAIConfig } from "../config/ai";
import { resolveProviderApiKey } from "../secrets/resolver";
import { submitWanVideo } from "../video/wanVideoClient";
import { resolveWanReferenceImages } from "../video/referenceImages";
import type { VideoProvider } from "./types";
import { getWanVideoCapability } from "./wanVideoCapability";

const MANUAL_MESSAGE = "Wan 2.7 真实调用当前不可用，可从视频库导入完整广告视频作为备用路径。";

export const wanVideoProvider: VideoProvider = {
  provider: "wan",
  async generateVideo() {
    const config = getAIConfig({ allowSessionSecrets: true });
    return {
      success: false,
      data: { taskId: "", videoUrl: "", status: "not-implemented" },
      provider: "wan",
      model: config.video.model,
      costEstimate: 0,
      latencyEstimate: "not-applicable",
      error: `${MANUAL_MESSAGE} 请通过多参考图生成入口调用。`
    };
  },
  async generateHeroVideoFromImage(input) {
    const config = getAIConfig({ allowSessionSecrets: true });
    const hasKey = Boolean(await resolveProviderApiKey("wan", input.sessionId));
    const apiAvailable = config.realVideoEnabled && hasKey;

    if (!apiAvailable || !input.projectId || !input.shotId) {
      return {
        success: false,
        ...getWanVideoCapability(true, apiAvailable),
        error: apiAvailable
          ? "缺少项目或镜头参数，无法创建 Wan 2.7 视频任务。"
          : MANUAL_MESSAGE
      };
    }

    try {
      const referenceImages = await resolveWanReferenceImages({
        sessionId: input.sessionId!,
        projectId: input.projectId,
        heroImageAssetId: input.heroImageAssetId,
        productImages: input.productImages
      });

      return await submitWanVideo({
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
        model: config.video.model,
        latencyMs: 0,
        error: error instanceof Error ? error.message : "Wan 2.7 参考图准备失败。"
      };
    }
  }
};
