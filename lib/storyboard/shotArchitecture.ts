import type { MicroBeat, ShotFrame, ShotFrameRole, ShotSubclip, StoryboardShot } from "../schemas/project";

const FRAME_COUNTS: Record<number, number> = { 3: 2, 4: 3, 5: 4, 6: 4, 7: 5, 8: 5 };
const BEAT_RANGES: Record<number, readonly [number, number]> = {
  3: [2, 4], 4: [3, 5], 5: [4, 6], 6: [5, 7], 7: [5, 8], 8: [6, 9]
};
const ROLES: ShotFrameRole[] = ["start", "setup", "action", "product", "reaction", "transition", "end"];

export function frameCountForDuration(durationSec: number) {
  return FRAME_COUNTS[Math.max(3, Math.min(8, Math.round(durationSec)))] ?? 3;
}

export function microBeatRangeForDuration(durationSec: number): readonly [number, number] {
  return BEAT_RANGES[Math.max(3, Math.min(8, Math.round(durationSec)))] ?? [3, 5];
}

export function buildDefaultShotFrames(shot: StoryboardShot): ShotFrame[] {
  const count = frameCountForDuration(shot.durationSec);
  return Array.from({ length: count }, (_, index) => {
    const role = frameRole(index, count, Boolean(shot.containsProduct));
    const timestampSec = Number(((shot.durationSec * index) / Math.max(1, count - 1)).toFixed(2));
    const moment = frozenMoment(shot, role, index);
    return {
      id: `${shot.id}-frame-${index + 1}`,
      shotId: shot.id,
      index,
      role,
      timestampSec,
      description: moment,
      imagePromptCn: `${moment}。这是一个明确的静止瞬间，只呈现一个完整画面，不表现动作序列。${shot.imagePromptCn}`,
      imagePromptEn: `One frozen moment: ${moment}. Show one full-frame image only, never an action sequence. ${shot.imagePromptEn}`,
      ...(shot.negativePromptCn ? { negativePromptCn: shot.negativePromptCn } : {}),
      ...(shot.negativePromptEn ? { negativePromptEn: shot.negativePromptEn } : {}),
      ...(index === 0 && shot.keyframeAssetId ? { assetId: shot.keyframeAssetId, status: "ready" as const } : { status: "pending" as const }),
      isLocked: Boolean(index === 0 && shot.keyframeAssetId),
      ...(shot.sceneStateBefore ? { sceneStateBefore: shot.sceneStateBefore } : {}),
      ...(shot.sceneStateAfter ? { sceneStateAfter: shot.sceneStateAfter } : {})
    };
  });
}

export function buildDefaultMicroBeats(shot: StoryboardShot, frames = shot.frames ?? buildDefaultShotFrames(shot)): MicroBeat[] {
  const [min, max] = microBeatRangeForDuration(shot.durationSec);
  const isPause = /停顿|静止|余韵|end card|pause|hold/i.test(`${shot.goal} ${shot.visualDescription}`);
  const count = isPause ? min : Math.min(max, Math.max(min, Math.round(shot.durationSec)));
  const step = shot.durationSec / count;
  return Array.from({ length: count }, (_, index) => {
    const frame = frames[Math.min(frames.length - 1, Math.floor(index * frames.length / count))];
    const startSec = Number((index * step).toFixed(2));
    const endSec = Number((index === count - 1 ? shot.durationSec : (index + 1) * step).toFixed(2));
    const purpose = index === 0 ? "orient" : index === count - 1 ? "resolve" : shot.containsProduct && index === Math.floor(count / 2) ? "demonstrate" : "emphasize";
    return {
      id: `${shot.id}-beat-${index + 1}`, shotId: shot.id, index, purpose,
      startSec, endSec, action: simpleAction(shot, index, count),
      stateChange: `${frame?.role ?? "action"} state advances to beat ${index + 1}`,
      complexity: Math.min(4, Math.max(1, index === 0 || index === count - 1 ? 1 : 2)),
      ...(frame ? { frameId: frame.id } : {})
    };
  });
}

export function ensureShotArchitecture(shot: StoryboardShot): StoryboardShot {
  const generatedFrames = buildDefaultShotFrames(shot);
  const frames = (shot.frames?.length ? shot.frames : generatedFrames)
    .slice(0, 5)
    .map((frame, index) => ({
      ...frame, id: frame.id || `${shot.id}-frame-${index + 1}`, shotId: shot.id, index,
      ...(index === 0 && !frame.assetId && shot.keyframeAssetId ? { assetId: shot.keyframeAssetId, status: "ready" as const, isLocked: true } : {})
    }));
  const microBeats = shot.microBeats?.length ? shot.microBeats : buildDefaultMicroBeats(shot, frames);
  return {
    ...shot, frames, microBeats,
    subclips: shot.subclips ?? buildShotSubclips({ ...shot, frames, microBeats }),
    narrativeProgression: shot.narrativeProgression ?? {
      previousState: shot.sceneStateBefore ? "Established incoming scene state" : "Audience has not yet received this shot's information",
      newInformation: shot.goal,
      resultingState: shot.sceneStateAfter ? "Scene state updated by this shot" : shot.visualDescription
    },
    primaryKeyframeAssetId: shot.primaryKeyframeAssetId ?? frames.find((frame) => frame.assetId)?.assetId
  };
}

export function ensureStoryboardArchitecture(shots: StoryboardShot[]) {
  return shots.map(ensureShotArchitecture);
}

export function validateShotContentDensity(shot: StoryboardShot) {
  const frames = shot.frames ?? [];
  const beats = shot.microBeats ?? [];
  const [minBeats, maxBeats] = microBeatRangeForDuration(shot.durationSec);
  const expectedFrames = frameCountForDuration(shot.durationSec);
  return {
    passed: frames.length >= Math.max(2, expectedFrames - (shot.durationSec === 5 || shot.durationSec >= 7 ? 1 : 0))
      && frames.length <= expectedFrames && beats.length >= minBeats && beats.length <= maxBeats,
    frameCount: frames.length, expectedFrames, beatCount: beats.length, minBeats, maxBeats
  };
}

export function validateMicroBeatTimeline(shot: StoryboardShot) {
  const beats = [...(shot.microBeats ?? [])].sort((a, b) => a.startSec - b.startSec);
  return beats.every((beat, index) => beat.startSec >= 0 && beat.endSec > beat.startSec
    && beat.endSec <= shot.durationSec && (index === 0 || beat.startSec >= beats[index - 1]!.endSec - 0.02));
}

export function selectShotVideoStrategy(shot: StoryboardShot): "single-clip" | "first-last-frame" | "two-subclips" {
  if ((shot.subclips?.length ?? 0) > 1 || shot.durationSec >= 7 || (shot.motionComplexityScore ?? 0) >= 7) return "two-subclips";
  if ((shot.frames?.length ?? 0) >= 2 && shot.durationSec >= 5) return "first-last-frame";
  return "single-clip";
}

export function buildShotSubclips(shot: StoryboardShot): ShotSubclip[] {
  const frames = shot.frames ?? [];
  if (!frames.length) return [];
  const count = shot.durationSec >= 7 || (shot.motionComplexityScore ?? 0) >= 7 ? 2 : 1;
  const duration = shot.durationSec / count;
  return Array.from({ length: count }, (_, index) => ({
    id: `${shot.id}-subclip-${index + 1}`, shotId: shot.id, index,
    startSec: Number((index * duration).toFixed(2)), durationSec: Number((index === count - 1 ? shot.durationSec - index * duration : duration).toFixed(2)),
    startFrameId: frames[Math.min(frames.length - 1, Math.floor(index * frames.length / count))]!.id,
    ...(frames.length > 1 ? { endFrameId: frames[Math.min(frames.length - 1, Math.floor((index + 1) * frames.length / count))]!.id } : {}),
    status: "pending" as const
  }));
}

export function buildTimedChoreography(shot: StoryboardShot) {
  const beats = shot.microBeats ?? buildDefaultMicroBeats(shot);
  return beats.map((beat) => `[${beat.startSec.toFixed(2)}-${beat.endSec.toFixed(2)}s] ${beat.action}; state change: ${beat.stateChange}.`).join("\n");
}

function frameRole(index: number, count: number, containsProduct: boolean): ShotFrameRole {
  if (index === 0) return "start";
  if (index === count - 1) return "end";
  if (containsProduct && index === Math.floor(count / 2)) return "product";
  return ROLES[Math.min(ROLES.length - 1, index + 1)] ?? "action";
}

function frozenMoment(shot: StoryboardShot, role: ShotFrameRole, index: number) {
  const labels: Record<ShotFrameRole, string> = {
    start: "镜头起始状态已建立", setup: "主体与环境关系清晰", action: "核心动作停在最具辨识度的一刻",
    product: "真实产品完整清晰地处于视觉焦点", reaction: "人物反应停在自然表情瞬间",
    transition: "状态变化后的稳定瞬间", end: "镜头结果状态清晰成立"
  };
  return `${labels[role]}（帧 ${index + 1}）：${shot.visualDescription}`;
}

function simpleAction(shot: StoryboardShot, index: number, count: number) {
  if (index === 0) return "Hold the established pose and orient the viewer";
  if (index === count - 1) return "Settle into the resulting state and hold";
  return `Perform one simple visible action toward: ${shot.goal}`;
}
