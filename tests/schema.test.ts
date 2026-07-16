import { describe, expect, it } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import {
  adStrategySchema,
  generationProjectSchema,
  modelRouteSchema,
  productBriefSchema,
  storyboardShotSchema
} from "../lib/schemas/project";

describe("AIGC ad director schemas", () => {
  it("validates the coldBrewDemo generation project", () => {
    const result = generationProjectSchema.safeParse(coldBrewDemo);

    expect(result.success).toBe(true);
  });

  it("validates each core section inside coldBrewDemo", () => {
    expect(productBriefSchema.safeParse(coldBrewDemo.brief).success).toBe(true);
    expect(adStrategySchema.safeParse(coldBrewDemo.strategy).success).toBe(true);
    expect(storyboardShotSchema.safeParse(coldBrewDemo.shots[0]).success).toBe(true);
    expect(modelRouteSchema.safeParse(coldBrewDemo.modelRoutes[0]).success).toBe(true);
  });

  it("matches the required cold brew demo constraints", () => {
    expect(coldBrewDemo.brief.productName).toBe("低糖冷萃咖啡");
    expect(coldBrewDemo.brief.targetAudience).toBe("一线城市上班族");
    expect(coldBrewDemo.brief.aspectRatio).toBe("9:16");
    expect(coldBrewDemo.brief.durationSec).toBe(28);
    expect(coldBrewDemo.shots).toHaveLength(4);
    expect(coldBrewDemo.shots.reduce((total, shot) => total + shot.durationSec, 0)).toBe(28);
    expect(coldBrewDemo.costEstimates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "最低成本演示模式", minCny: 8, maxCny: 15 }),
        expect.objectContaining({ label: "自动化视频模式", minCny: 15, maxCny: 35 })
      ])
    );
  });
});
