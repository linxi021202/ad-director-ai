import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { coldBrewDemo } from "@/lib/mock/coldBrewDemo";
import { buildShotPromptExpansionPrompt } from "@/lib/prompts/detailedDirectorPrompts";
import { detailedShotPromptPackageSchema } from "@/lib/schemas/project";
import { reviewDetailedPromptPackage } from "@/lib/director/promptQualityReview";
import { getActionBlockers } from "@/lib/workflow/actionBlockers";

describe("DeepSeek staged director quality", () => {
  it("builds PASS C for one shot with master continuity and zero-text rules", () => {
    const prompt = buildShotPromptExpansionPrompt({ brief: coldBrewDemo.brief, strategy: coldBrewDemo.strategy, shot: coldBrewDemo.shots[0]! });
    expect(prompt).toContain("只扩写一个镜头");
    expect(prompt).toContain("Start State");
    expect(prompt).toContain("零生成文字策略");
    expect(prompt).toContain("单一完整摄影画面");
    expect(prompt).toContain(coldBrewDemo.shots[0]!.id);
  });

  it("accepts a dense prompt package and rejects shallow quality scores", () => {
    const packageValue = promptPackage();
    const parsed = detailedShotPromptPackageSchema.safeParse(packageValue);
    expect(parsed.success, parsed.success ? undefined : parsed.error.message).toBe(true);
    expect(reviewDetailedPromptPackage(packageValue).passed).toBe(true);
    expect(detailedShotPromptPackageSchema.safeParse({ ...packageValue, qualityScores: { ...packageValue.qualityScores, visualSpecificity: 6 } }).success).toBe(false);
  });

  it("uses per-shot expansion and persists full packages", () => {
    const route = readFileSync("app/api/generate-assets/route.ts", "utf8");
    const store = readFileSync("lib/projects/anonymousProjectStore.ts", "utf8");
    expect(route).toContain("pendingInputs.slice(0, parsed.data.batchSize)");
    expect(route).toContain("for (const [shotOffset, input] of sourceInputs.entries())");
    expect(route).toContain("expandShotPrompts");
    expect(route).toContain("saveOwnedShotPromptPackage");
    expect(route).toContain("saveOwnedShotPromptDraft");
    expect(route).toContain("resumeShotPromptDraft: checkpoint");
    expect(route).toContain("updateGenerationEventProgress");
    expect(route).toContain("validPromptPackageIds");
    expect(route).toContain("inputFingerprint");
    expect(route).toContain("continuationRequired");
    expect(route).toContain("shotPromptPackages");
    expect(store).toContain("export async function saveOwnedShotPromptPackage");
    expect(store).toContain("shotPromptPackages: [...packageByShot.values()]");
  });

  it("does not let optional product analysis block confirmation", () => {
    const productImage = { id: "main", role: "main-product" as const, name: "product.png", type: "image/png" as const, size: 1024, assetId: "11111111-1111-4111-8111-111111111111" };
    const project = { ...coldBrewDemo, brief: { ...coldBrewDemo.brief, productImages: [productImage] }, productVisualSpec: undefined };
    expect(getActionBlockers(project, "CONFIRM_PRODUCT")).toEqual([]);
  });

  it("ships explainable actions, onboarding and full prompt copy controls", () => {
    expect(readFileSync("components/workflow/GuardedActionButton.tsx", "utf8")).toContain('aria-disabled={blocked || undefined}');
    expect(readFileSync("components/workspace/UsageGuideSheet.tsx", "utf8")).toContain("用 1 分钟了解广告怎么生成");
    expect(readFileSync("components/storyboard/StoryboardTimeline.tsx", "utf8")).toContain("navigator.clipboard.writeText");
  });
});

function promptPackage() {
  const cn = `${"确定冻结瞬间。人物位于画面左侧，右手放在桌面，视线看向中景真实产品。前景办公用品建立空间深度，中景保持产品正面朝向，背景办公室窗户位于右侧。摄影机与人物视线平齐，五十毫米焦段，主光从右侧进入，辅光压低阴影，杯体材质与反射清晰，包装结构和比例不变，不出现任何可读文字。".repeat(4)}这是一张单一完整摄影画面，只描述一个确定时间点。不得把前后动作阶段同时展示在一张图片中。`;
  const en = "One frozen commercial photography moment with a clearly positioned subject, stable product orientation, foreground, middle ground, background, camera height, focal length, aperture, depth of field, key light, fill light, practical light, shadow, reflection, material detail, spatial depth, identity continuity, no readable text, no split screen, and no collage. ".repeat(4);
  return {
    shotId: coldBrewDemo.shots[0]!.id,
    continuityContext: { product: "同一真实产品原图的容器轮廓和包装结构", character: "同一位主角的脸型发型年龄感和肤色", wardrobe: "同一套深色通勤服装和饰品", scene: "同一办公室空间结构和窗户位置", sceneState: "保持夜间低能量状态", majorProps: ["显示器", "键盘"], previousShotState: "广告开场前的安静办公状态", immutableElements: ["产品容器不变", "人物身份不变", "办公室结构不变"], allowedChanges: ["表情和视线可变化"] },
    directingNotesCn: "机位与人物视线平齐，使用五十毫米焦段，前景办公用品建立空间，中景承载人物和产品，背景保留窗户。主光从右侧进入，材质、产品位置、手部动作和视线变化都必须可执行。".repeat(2),
    directingNotesEn: en,
    framePrompts: [{ frameId: "frame-1", timestampSec: 0, role: "start", frozenMoment: "人物右手停在键盘旁并第一次看向桌面产品的确定瞬间", subject: "同一位通勤主角与真实产品", subjectPosition: "人物位于画面左侧，产品位于右下方", characterPose: "坐姿微微前倾且肩膀保持放松", facialExpression: "克制而略显疲惫的表情", gazeDirection: "从屏幕转向产品", handState: "右手停在键盘旁，左手自然放松", productPosition: "产品稳定放在桌面右侧中景区域", productOrientation: "包装正面朝向摄影机", productScale: "画面高度八分之一", environment: "同一城市办公室内部，桌面陈设位置固定", foreground: "虚化桌角与文件", middleGround: "人物双手和产品", background: "窗户显示器和椅子", composition: "偏心三分构图保留顶部安全区", cameraHeight: "人物视线高度", cameraAngle: "轻微侧前方", lens: "标准镜头", focalLength: "50mm", aperture: "f/2.8", depthOfField: "主体清晰背景轻微虚化", lightingDirection: "右侧窗户到左侧", lightingQuality: "柔和且有方向的主光", keyLight: "右侧窗户柔光", fillLight: "左前方低强度补光", practicalLights: "背景显示器冷色环境光", shadowBehavior: "阴影向左后方自然衰减", reflections: "杯体反射受控且不遮盖包装", materialDetails: "杯体、杯盖和服装织物纹理清晰", colorDesign: "冷灰环境配真实包装主色", atmosphere: "安静且带有轻微疲惫感", spatialDepth: "前中后景清晰分层", continuityConstraints: ["产品结构不变", "人物身份不变", "场景结构不变"], forbiddenChanges: ["禁止新增文字", "禁止改变容器", "禁止新增人物"], imagePromptCn: cn, imagePromptEn: en, negativePromptCn: "禁止任何可读文字、乱码、额外标识、拼贴、分屏、多格画面、重复主体、手部畸形、额外手指以及产品容器结构变化", negativePromptEn: "no readable text, gibberish, collage, split screen, deformed hands, or changed product container" }],
    videoPromptCn: "开始状态 Start State：人物右手停在键盘旁，产品稳定放在桌面右侧。0.0s-1.5s 人物只将视线从屏幕移向产品，双手保持稳定；1.5s-3.0s 右手缓慢接近产品但不遮挡包装，摄影机沿一条路径轻微推近；3.0s-5.0s 人物手指轻触杯体后停止，产品不旋转，环境光只略微变亮。结束状态 End State：人物视线和右手都停在产品附近，产品结构、比例、材质和位置保持稳定。禁止手指畸形、额外肢体、容器改变、新增人物、切镜、拼贴和任何可读文字。".repeat(2),
    videoPromptEn: en,
    negativePromptCn: "禁止任何可读文字、乱码、额外标识、水印、拼贴、分屏、多格画面、重复主体、手部畸形、额外手指、额外肢体，以及产品容器、包装结构、比例、颜色和材质发生变化。",
    negativePromptEn: "no readable text, gibberish, collage, split screen, extra fingers, deformed hands, or product changes",
    textSafeZone: "top-center", qaChecklist: ["保持单一完整画面", "产品结构始终保持", "人物身份始终保持", "场景空间结构保持", "镜头动作可以执行", "画面坚持零生成文字", "防止手部和手指变形"],
    qualityScores: { creativeDepth: 9, visualSpecificity: 9, productConsistency: 9, characterContinuity: 9, sceneContinuity: 9, actionExecutability: 9, textRisk: 1, deformationRisk: 2 }
  };
}
