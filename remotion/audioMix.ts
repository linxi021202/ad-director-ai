export function getBackgroundMusicVolume(frame: number, intervals: Array<{ start: number; end: number }>) {
  return intervals.some((interval) => frame >= interval.start - 5 && frame <= interval.end + 5) ? 0.18 : 0.55;
}

export function shouldMuteSourceAudio(voiceoverUrl: string | undefined, narrationBeatCount: number) {
  return Boolean(voiceoverUrl || narrationBeatCount > 0);
}
