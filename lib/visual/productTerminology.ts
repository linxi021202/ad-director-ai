import type { ProductContainerType, ProductVisualSpec, StoryboardShot } from "../schemas/project";

const TERMS: Record<ProductContainerType, { cn: string; en: string; patterns: RegExp[] }> = {
  bottle: { cn: "瓶", en: "bottle", patterns: [/冷萃瓶|饮料瓶|塑料瓶|玻璃瓶|瓶装|瓶身|瓶盖|瓶/gi, /plastic bottle|glass bottle|beverage bottle|bottled|bottle/gi] },
  carton: { cn: "纸盒", en: "carton", patterns: [/纸盒|盒装|利乐包/gi, /carton|tetra pak/gi] },
  can: { cn: "罐", en: "can", patterns: [/易拉罐|罐装|金属罐/gi, /(?:a|the|one|aluminum|metal|tin)\s+can\b|\bcan\s+(?:on|with|container|package|product|drink|beverage)\b/gi] },
  pouch: { cn: "袋装产品", en: "pouch", patterns: [/袋装|软袋|袋/gi, /pouch|sachet/gi] },
  jar: { cn: "罐形容器", en: "jar", patterns: [/广口罐|玻璃罐/gi, /glass jar|jar/gi] },
  tube: { cn: "软管", en: "tube", patterns: [/软管|管状包装/gi, /tube/gi] },
  box: { cn: "盒", en: "box", patterns: [/包装盒|盒装/gi, /product box|boxed package/gi] },
  cup: { cn: "咖啡杯", en: "product cup", patterns: [/咖啡杯|杯装|杯盖|杯/gi, /coffee cup|product cup|cup/gi] },
  other: { cn: "真实产品", en: "real product", patterns: [] }
};

export type ProductTerminologyValidation = {
  valid: boolean;
  conflicts: string[];
  repairedPrompt: string;
};

export function validateProductTerminology(prompt: string, spec?: ProductVisualSpec): ProductTerminologyValidation {
  if (!spec) return { valid: true, conflicts: [], repairedPrompt: prompt };
  const expected = TERMS[spec.containerType];
  const forbidden = spec.forbiddenContainerTypes.filter((type) => type !== spec.containerType);
  const conflicts = forbidden.filter((type) => TERMS[type].patterns.some((pattern) => test(pattern, prompt)));
  let repairedPrompt = prompt;
  for (const type of conflicts) {
    for (const pattern of TERMS[type].patterns) {
      repairedPrompt = repairedPrompt.replace(pattern, (match) => /[\u4e00-\u9fff]/.test(match) ? expected.cn : expected.en);
    }
  }
  return { valid: conflicts.length === 0, conflicts, repairedPrompt };
}

export function repairShotProductTerminology(shot: StoryboardShot, spec?: ProductVisualSpec): StoryboardShot {
  if (!spec) return shot;
  const repair = (value: string | undefined) => value === undefined ? undefined : validateProductTerminology(value, spec).repairedPrompt;
  return {
    ...shot,
    goal: repair(shot.goal)!,
    visualDescription: repair(shot.visualDescription)!,
    imagePromptCn: repair(shot.imagePromptCn)!,
    imagePromptEn: repair(shot.imagePromptEn)!,
    videoPromptCn: repair(shot.videoPromptCn)!,
    ...(shot.videoPromptEn ? { videoPromptEn: repair(shot.videoPromptEn) } : {}),
    ...(shot.negativePromptCn ? { negativePromptCn: repair(shot.negativePromptCn) } : {}),
    ...(shot.negativePromptEn ? { negativePromptEn: repair(shot.negativePromptEn) } : {})
  };
}

function test(pattern: RegExp, value: string) {
  pattern.lastIndex = 0;
  return pattern.test(value);
}
