import { describe, expect, it } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { ensureShotArchitecture } from "../lib/storyboard/shotArchitecture";
import { hasDuplicatedFramePrompts, planShotKeyframeMoments, validateDetailedKeyframePlan } from "../lib/storyboard/keyframePlan";
import { buildOptimizedVideoPrompt } from "../lib/heroVideo";
import type { DetailedFramePrompt } from "../lib/schemas/project";

const base = ensureShotArchitecture({ ...coldBrewDemo.shots[0]!, durationSec: 4 });
const shot = { ...base, frames: base.frames!.slice(0, 2), microBeats: [
  { id: "beat-1", shotId: base.id, index: 0, purpose: "orient" as const, startSec: 0, endSec: 1, action: "人物视线从屏幕转向桌面产品", stateChange: "注意到产品", handAction: "右手保持在键盘旁", complexity: 1 },
  { id: "beat-2", shotId: base.id, index: 1, purpose: "reveal" as const, startSec: 1, endSec: 2, action: "右手伸向产品", stateChange: "准备握持", complexity: 2 },
  { id: "beat-3", shotId: base.id, index: 2, purpose: "demonstrate" as const, startSec: 2, endSec: 3, action: "右手握住产品并抬离桌面", stateChange: "产品位于胸腹之间", complexity: 2 },
  { id: "beat-4", shotId: base.id, index: 3, purpose: "resolve" as const, startSec: 3, endSec: 4, action: "人物坐直并看向产品", stateChange: "握持姿态稳定", complexity: 1 }
] };

function frame(index: number): DetailedFramePrompt {
  const moment = planShotKeyframeMoments(shot)[index]!;
  return {
    frameId: moment.frameId, timestampSec: moment.timestampSec, role: index ? "end" : "start",
    frozenMoment: index ? "右手已经握住产品并将其抬离桌面的确定瞬间" : "右手仍在键盘旁并刚注意到桌面产品的确定瞬间",
    subject: "同一人物和同一个真实产品", subjectPosition: "人物位于左侧，产品位于右侧", characterPose: "人物坐在相同办公椅上", facialExpression: "自然克制的表情",
    gazeDirection: index ? "视线落在手中的产品上" : "视线刚从屏幕转向桌面", handState: index ? "右手握住产品并抬离桌面" : "右手仍停在键盘旁边",
    productPosition: index ? "产品已抬到人物胸腹之间" : "产品仍完整放在桌面", productOrientation: "包装正面朝向摄影机", productScale: "画面高度八分之一",
    environment: "同一办公室空间和桌面布局", foreground: "桌面物件", middleGround: "人物和产品", background: "显示器与窗户",
    composition: "同一个办公室中的偏心构图", cameraHeight: "人物视线高度", cameraAngle: "正面偏侧", lens: "标准镜头", focalLength: "50mm", aperture: "f/2.8", depthOfField: "人物与产品清晰",
    lightingDirection: "右侧窗光", lightingQuality: "柔和主光", keyLight: "右侧窗光", fillLight: "左前方补光", practicalLights: "显示器环境光", shadowBehavior: "向左衰减", reflections: "杯体反射受控", materialDetails: "包装和织物纹理完整",
    colorDesign: "冷灰背景和真实包装色", atmosphere: "安静的办公氛围", spatialDepth: "前中后景明确", continuityConstraints: ["同一人物", "同一产品", "同一办公室"], forbiddenChanges: ["不新增文字", "不改包装", "不换人物"],
    imagePromptCn: `单一完整画面，${moment.momentDescription}。禁止生成可读文字。`.repeat(15), imagePromptEn: `One full frame at ${moment.timestampSec}: ${moment.momentDescription}. No readable text. `.repeat(6),
    negativePromptCn: "禁止可读文字、分屏、拼贴、额外人物和包装变化", negativePromptEn: "No readable text, split screen, collage, added people or altered packaging."
  };
}

describe("keyframe moment planning", () => {
  it("places two moments on meaningful beats about two seconds apart", () => {
    const moments = planShotKeyframeMoments(shot);
    expect(moments.map((item) => item.timestampSec)).toEqual([0.5, 2.6]);
    expect(moments.map((item) => item.microBeatId)).toEqual(["beat-1", "beat-3"]);
    expect(moments[0]?.momentDescription).toContain("键盘旁");
    expect(moments[1]?.momentDescription).toContain("抬离桌面");
  });

  it("preserves one identity and scene while requiring distinct physical states", () => {
    const frames = [frame(0), frame(1)];
    expect(validateDetailedKeyframePlan(shot, frames)).toEqual({ passed: true });
    expect(frames[0]?.subject).toBe(frames[1]?.subject);
    expect(frames[0]?.environment).toBe(frames[1]?.environment);
    expect(frames[0]?.handState).not.toBe(frames[1]?.handState);
    expect(frames[0]?.productPosition).not.toBe(frames[1]?.productPosition);
  });

  it("rejects duplicate plans and impossible scene jumps before Qwen", () => {
    const first = frame(0);
    const duplicate = { ...first, frameId: shot.frames![1]!.id, timestampSec: 2.6, role: "end" };
    expect(validateDetailedKeyframePlan(shot, [first, duplicate])).toMatchObject({ passed: false, code: "KEYFRAME_PLAN_DUPLICATED" });
    expect(validateDetailedKeyframePlan(shot, [first, { ...frame(1), environment: "陌生地铁车厢和全新座椅" }]))
      .toMatchObject({ passed: false, code: "KEYFRAME_TRANSITION_IMPLAUSIBLE" });
    expect(hasDuplicatedFramePrompts({ ...shot, frames: shot.frames!.map((item, index) => ({
      ...item, imagePromptCn: `帧 ${index + 1}：同一画面`, imagePromptEn: `Frame ${index + 1}: same image`
    })) })).toBe(true);
  });

  it("passes persisted moments and their timing into the video prompt", () => {
    const moments = planShotKeyframeMoments(shot);
    const withMoments = { ...shot, frames: shot.frames!.map((item, index) => ({ ...item, keyframeMoment: {
      ...moments[index]!, characterPose: frame(index).characterPose, handState: frame(index).handState,
      gazeDirection: frame(index).gazeDirection, facialExpression: frame(index).facialExpression,
      productPosition: frame(index).productPosition, productOrientation: frame(index).productOrientation,
      cameraAngle: frame(index).cameraAngle, environment: frame(index).environment
    } })) };
    const prompt = buildOptimizedVideoPrompt(withMoments);
    expect(prompt).toContain("0.50 秒");
    expect(prompt).toContain("2.60 秒");
    expect(prompt).toContain("抬离桌面");
  });
});
