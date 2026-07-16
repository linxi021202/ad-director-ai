export function estimateQwenImageCost(size: string, count = 1): string {
  const normalizedSize = size.trim();
  const perImageCny = normalizedSize === "1152*2048" ? 0.24 : 0.2;
  return `estimated ¥${(perImageCny * count).toFixed(2)}`;
}

