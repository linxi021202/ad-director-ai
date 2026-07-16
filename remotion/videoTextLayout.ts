export type VideoTextRole = "body" | "label" | "subtitle" | "headline" | "cta";
export type VideoSafeArea = { horizontal: number; bottom: number };

export function getVideoSafeArea(width: number, height: number): VideoSafeArea {
  const ratio = width / height;
  if (ratio > 1.4) return { horizontal: 96, bottom: 80 };
  if (ratio > 0.9) return { horizontal: 72, bottom: 100 };
  return { horizontal: 72, bottom: 160 };
}

export function getResponsiveVideoFontSize(
  role: VideoTextRole,
  width: number,
  text: string,
  maxWidth: number,
  maxLines: 1 | 2
) {
  const scale = { body: 0.032, label: 0.026, subtitle: 0.048, headline: 0.066, cta: 0.04 }[role];
  const min = { body: 24, label: 20, subtitle: 32, headline: 42, cta: 28 }[role];
  const max = { body: 42, label: 34, subtitle: 54, headline: 76, cta: 46 }[role];
  const preferred = clamp(width * scale, min, max);
  const textUnits = Array.from(text).reduce((sum, char) => sum + (/^[\x00-\x7F]$/.test(char) ? 0.58 : 1), 0);
  const capacity = Math.max(1, (maxWidth / (preferred * 1.04)) * maxLines);
  if (textUnits <= capacity) return preferred;
  return clamp(preferred * (capacity / textUnits), min * 0.78, preferred);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
