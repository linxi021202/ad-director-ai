import { z } from "zod";

export const promptQualityIssueSchema = z.object({
  path: z.string().min(1), code: z.string().min(1), reason: z.string().min(1), suggestion: z.string().min(1)
}).strict();
export type PromptQualityIssue = z.infer<typeof promptQualityIssueSchema>;

export const DETAILED_PROMPT_CONTRACT = `continuityContext 的 product、character、wardrobe、scene、sceneState、previousShotState 只能是具体自然语言字符串，不能是对象；majorProps、immutableElements、allowedChanges 是字符串数组。textSafeZone 只能是自然语言字符串，说明位置、避让区域和用途，不能是对象。cameraAngle 是非空字符串，平视、俯拍、低机位等均可，但须结合 cameraHeight、composition、focalLength 给出可执行摄影信息。`;

const continuityLabels: Record<string, string> = {
  identity: "身份", fixedTraits: "固定特征", currentState: "当前状态", appearance: "外观", description: "说明",
  position: "位置", location: "位置", orientation: "朝向", scale: "比例", material: "材质", color: "颜色",
  structure: "结构", lighting: "光线", atmosphere: "氛围", spatialState: "空间状态", spatialLayout: "空间布局",
  wardrobe: "服装", props: "道具", immutableElements: "固定元素", allowedChanges: "允许变化", notes: "注意事项"
};
const safeZoneLabels = { enabled: "预留文字安全区", position: "位置", avoidAreas: "避让区域", notes: "注意事项", note: "说明" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Unknown keys or nested structures remain invalid: compatibility must not silently discard semantics.
function normalizeDescription(value: unknown, labels: Record<string, string>, allowEnabled = false): unknown {
  if (!isRecord(value) || !Object.keys(value).length) return value;
  if (Object.entries(value).some(([key, item]) => !labels[key] || !(typeof item === "string" && item.trim()
    || Array.isArray(item) && item.length && item.every((part) => typeof part === "string" && part.trim())
    || allowEnabled && key === "enabled" && typeof item === "boolean"))) return value;
  return Object.keys(labels).filter((key) => key in value).map((key) => {
    const item = value[key];
    return `${labels[key]}：${typeof item === "boolean" ? item ? "是" : "否" : Array.isArray(item) ? item.join("、") : item}`;
  }).join("；");
}

export function normalizeDetailedPromptOutput(raw: unknown): { value: unknown; normalized: boolean } {
  if (!isRecord(raw)) return { value: raw, normalized: false };
  const value = { ...raw };
  let normalized = false;
  if (isRecord(raw.continuityContext)) {
    const continuity = { ...raw.continuityContext };
    for (const key of ["product", "character", "wardrobe", "scene", "sceneState", "previousShotState"]) {
      const converted = normalizeDescription(continuity[key], continuityLabels);
      if (converted !== continuity[key]) { continuity[key] = converted; normalized = true; }
    }
    value.continuityContext = continuity;
  }
  const safeZone = normalizeDescription(raw.textSafeZone, safeZoneLabels, true);
  if (safeZone !== raw.textSafeZone) { value.textSafeZone = safeZone; normalized = true; }
  return { value, normalized };
}
