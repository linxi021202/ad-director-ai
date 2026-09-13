import { coldBrewDemo } from "./coldBrewDemo";

export { coldBrewDemo };

export const mockProject = {
  id: coldBrewDemo.id,
  name: coldBrewDemo.strategy.title,
  product: coldBrewDemo.brief,
  strategy: coldBrewDemo.strategy,
  storyboard: coldBrewDemo.shots,
  prompts: {
    imagePrompt: coldBrewDemo.shots[0]?.imagePromptCn ?? "",
    videoPrompt: coldBrewDemo.shots[0]?.videoPromptCn ?? "",
    reasoning: coldBrewDemo.strategy.bigIdea
  },
  modelRoute: coldBrewDemo.modelRoutes[0],
  costEstimate: {
    totalCny: coldBrewDemo.costEstimates[0]?.maxCny ?? 0,
    items: coldBrewDemo.modelRoutes.map((route) => ({
      name: route.primaryModel,
      costCny: route.estimatedCost
    }))
  },
  timeline: [
    {
      name: "广告需求",
      status: "done" as const,
      description: "已读取商品信息、平台、比例和广告时长。"
    },
    {
      name: "DeepSeek 文本生成",
      status: "done" as const,
      description: "DeepSeek 负责策略、分镜、图片 Prompt、视频 Prompt 和广告评分。"
    },
    {
      name: "Qwen-Image 关键帧",
      status: "done" as const,
      description: "Qwen-Image 负责广告关键帧生成，失败时回退占位图。"
    },
    {
      name: "Wan 2.7 视频节点",
      status: "running" as const,
      description: "Wan 2.7 使用当前关键帧和真实产品参考图生成广告视频。"
    }
  ],
  preview: {
    title: coldBrewDemo.strategy.title,
    description: coldBrewDemo.strategy.coreMessage,
    aspectRatio: "9:16" as const,
    durationSec: 40 as const
  }
};

