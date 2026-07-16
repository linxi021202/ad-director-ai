export type MediaOrientation = "portrait" | "square" | "landscape";

export type ParsedAspectRatio = {
  width: number;
  height: number;
  cssValue: string;
  numericRatio: number;
  orientation: MediaOrientation;
};

export function parseAspectRatio(value: string): ParsedAspectRatio {
  const [rawWidth, rawHeight] = value.split(":");
  const width = Number.parseFloat(rawWidth ?? "");
  const height = Number.parseFloat(rawHeight ?? "");

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return parseAspectRatio("9:16");
  }

  const numericRatio = width / height;
  const orientation: MediaOrientation = numericRatio < 0.85
    ? "portrait"
    : numericRatio > 1.2
      ? "landscape"
      : "square";

  return {
    width,
    height,
    cssValue: `${width} / ${height}`,
    numericRatio,
    orientation
  };
}
