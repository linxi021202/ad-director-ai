import type { DetailedFramePrompt, StoryboardShot } from "../schemas/project";

export type PlannedKeyframeMoment = {
  frameId: string;
  timestampSec: number;
  microBeatId?: string;
  narrativePurpose: string;
  momentDescription: string;
  continuityFromPreviousFrame: string;
};

export function planShotKeyframeMoments(shot: StoryboardShot): PlannedKeyframeMoment[] {
  const frames = shot.frames ?? [];
  const beats = [...(shot.microBeats ?? [])].sort((left, right) => left.startSec - right.startSec);
  const duration = shot.durationSec;
  return frames.map((frame, index) => {
    const target = frames.length === 1 ? duration * 0.45
      : frames.length === 2 ? (index === 0 ? Math.max(0.3, duration * 0.125) : Math.min(duration - 0.35, Math.max(0.3, duration * 0.125) + Math.min(2.1, duration - 0.8)))
      : 0.4 + ((duration - 0.8) * index) / (frames.length - 1);
    const beat = beats.find((item) => target >= item.startSec && target < item.endSec)
      ?? beats.reduce<typeof beats[number] | undefined>((nearest, item) => !nearest || Math.abs((item.startSec + item.endSec) / 2 - target) < Math.abs((nearest.startSec + nearest.endSec) / 2 - target) ? item : nearest, undefined);
    const timestampSec = Number(Math.min(duration - 0.1, Math.max(0.1, target)).toFixed(2));
    const momentDescription = [beat?.action, beat?.stateChange, beat?.handAction, beat?.gazeAction, beat?.productAction, beat?.cameraAction, beat?.expressionChange]
      .filter(Boolean).join("；") || frame.description;
    return {
      frameId: frame.id, timestampSec, ...(beat ? { microBeatId: beat.id } : {}),
      narrativePurpose: beat?.stateChange ?? beat?.action ?? frame.description,
      momentDescription,
      continuityFromPreviousFrame: index === 0 ? "建立本镜头的起始画面，保持已确认人物、产品和场景身份。"
        : `承接上一帧的同一人物、产品和空间，只推进当前动作：${momentDescription}`
    };
  });
}

function normalized(value: string) {
  return value.toLowerCase().replace(/frame\s*\d+|关键帧\s*\d+|帧\s*\d+|\d+(?:\.\d+)?\s*(?:秒|s)/gi, "").replace(/[\s\p{P}\p{S}]/gu, "");
}

function location(value: string) {
  return ["办公室", "地铁", "街道", "厨房", "卧室", "商场", "车内", "咖啡馆", "户外", "office", "subway", "street", "kitchen", "bedroom", "mall", "car", "cafe"]
    .find((word) => value.toLowerCase().includes(word));
}

export function validateDetailedKeyframePlan(shot: StoryboardShot, frames: DetailedFramePrompt[]) {
  const planned = planShotKeyframeMoments(shot);
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]!;
    const current = frames[index]!;
    const gap = current.timestampSec - previous.timestampSec;
    const momentSame = normalized(current.frozenMoment) === normalized(previous.frozenMoment);
    const statesSame = ["characterPose", "handState", "gazeDirection", "productPosition", "facialExpression"]
      .every((key) => normalized(current[key as keyof DetailedFramePrompt] as string) === normalized(previous[key as keyof DetailedFramePrompt] as string));
    if (gap < 0.5 || (momentSame && statesSame) || normalized(current.imagePromptEn) === normalized(previous.imagePromptEn)) {
      return { passed: false as const, code: "KEYFRAME_PLAN_DUPLICATED" as const, frameId: current.frameId };
    }
    const previousLocation = location(previous.environment);
    const currentLocation = location(current.environment);
    const abruptPose = /坐|seated|sitting/i.test(previous.characterPose) && /奔跑|running|冲刺|sprinting/i.test(current.characterPose);
    if ((previousLocation && currentLocation && previousLocation !== currentLocation) || (gap <= 2.5 && abruptPose)) {
      return { passed: false as const, code: "KEYFRAME_TRANSITION_IMPLAUSIBLE" as const, frameId: current.frameId };
    }
  }
  if (frames.length !== planned.length || frames.some((frame, index) => frame.frameId !== planned[index]?.frameId || frame.timestampSec !== planned[index]?.timestampSec)) {
    return { passed: false as const, code: "KEYFRAME_PLAN_DUPLICATED" as const, frameId: frames[0]?.frameId };
  }
  return { passed: true as const };
}

export function hasDuplicatedFramePrompts(shot: StoryboardShot) {
  const frames = shot.frames ?? [];
  return frames.some((frame, index) => index > 0 && normalized(frame.imagePromptEn) === normalized(frames[index - 1]!.imagePromptEn)
    && normalized(frame.imagePromptCn) === normalized(frames[index - 1]!.imagePromptCn));
}
