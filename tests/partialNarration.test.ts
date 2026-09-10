import { describe, expect, it } from "vitest";

import { buildPartialNarrationPlan, needsNarrationShortening } from "../lib/audio/narrationPlan";
import { wavDurationSec } from "../lib/audio/cosyVoiceClient";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { resolveNarrationSubtitle } from "../lib/render/renderProject";
import { getBackgroundMusicVolume, shouldMuteSourceAudio } from "../remotion/audioMix";

describe("partial narration", () => {
  const plan = buildPartialNarrationPlan(coldBrewDemo);

  it("defaults to partial with two to four beats", () => {
    expect(plan.mode).toBe("partial");
    expect(plan.beats.length).toBeGreaterThanOrEqual(2);
    expect(plan.beats.length).toBeLessThanOrEqual(4);
    expect(plan.beats.length).toBeLessThan(coldBrewDemo.shots.length);
  });

  it("starts with a problem beat", () => {
    expect(plan.beats[0]?.role).toBe("problem");
    expect(plan.beats[0]?.shotId).toBe(coldBrewDemo.shots[0]?.id);
  });

  it("ends with a dynamic brand payoff on the ending shot", () => {
    const payoff = plan.beats.find((beat) => beat.role === "brand-payoff");
    expect(payoff?.shotId).toBe(coldBrewDemo.shots.at(-1)?.id);
    expect(payoff?.text).toContain(coldBrewDemo.brief.productName);
  });

  it("reserves 0.4 seconds of breathing room for every beat", () => {
    plan.beats.forEach((beat) => {
      const shot = coldBrewDemo.shots.find((item) => item.id === beat.shotId)!;
      expect(beat.maxDurationSec).toBeLessThanOrEqual(shot.durationSec - 0.4);
    });
  });

  it("uses NarrationBeat text as the Remotion subtitle source", () => {
    const project = { ...coldBrewDemo, narrationPlan: plan };
    const beat = plan.beats[0]!;
    const shot = project.shots.find((item) => item.id === beat.shotId)!;
    expect(resolveNarrationSubtitle(project, shot)).toBe(beat.text);
    const silentShot = project.shots.find((item) => !plan.beats.some((candidate) => candidate.shotId === item.id))!;
    expect(resolveNarrationSubtitle(project, silentShot)).toBe("");
  });

  it("ducks BGM only around narration intervals", () => {
    expect(getBackgroundMusicVolume(20, [{ start: 10, end: 30 }])).toBe(0.18);
    expect(getBackgroundMusicVolume(100, [{ start: 10, end: 30 }])).toBe(0.55);
  });

  it("mutes Wan source audio whenever TTS beats exist", () => {
    expect(shouldMuteSourceAudio(undefined, 2)).toBe(true);
    expect(shouldMuteSourceAudio(undefined, 0)).toBe(false);
  });

  it("reads actual WAV duration for TTS fit checks", () => {
    expect(wavDurationSec(oneSecondWav())).toBe(1);
    expect(needsNarrationShortening(3.2, 2.6)).toBe(true);
    expect(needsNarrationShortening(2.4, 2.6)).toBe(false);
  });
});

function oneSecondWav() {
  const dataSize = 48_000;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  write(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(bytes, 8, "WAVE");
  write(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(bytes, 36, "data");
  view.setUint32(40, dataSize, true);
  return bytes;
}

function write(bytes: Uint8Array, offset: number, value: string) {
  [...value].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
}
