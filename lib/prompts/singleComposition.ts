export const SINGLE_FRAME_HARD_CONSTRAINT_CN =
  "只生成一张完整单帧画面，禁止分栏、拼贴、宫格、接触表、故事板、多联画、前后对比或在同一画布中展示连续动作。";
export const SINGLE_FRAME_HARD_CONSTRAINT_EN =
  "Generate exactly one full-frame image. No collage, split screen, contact sheet, storyboard, grid, multi-panel layout, before/after layout, or sequence of frames.";
export const SINGLE_VIDEO_HARD_CONSTRAINT_CN =
  "只生成一个连续的全画幅单镜头视频；允许多个按时间顺序发生的简单微动作，但必须处于同一时空并使用一条连续运镜，禁止切镜、分屏、拼贴、蒙太奇、多联画或同时展示多个时间点。";
export const SINGLE_VIDEO_HARD_CONSTRAINT_EN =
  "Generate exactly one continuous full-frame shot with a timed sequence of simple micro-actions in one space-time and one continuous camera path. No cuts, collage, split screen, montage, multi-panel layout, or simultaneous moments.";

export const SINGLE_COMPOSITION_NEGATIVE_PROMPT = [
  "分栏",
  "拼贴",
  "宫格",
  "九宫格",
  "接触表",
  "故事板",
  "三联画",
  "多联画",
  "前后对比",
  "连续动作同画布",
  "多个时间点",
  "split screen",
  "collage",
  "contact sheet",
  "storyboard",
  "grid layout",
  "multi-panel",
  "before and after",
  "sequence of frames"
].join("，");

const UNSAFE_POSITIVE_COMPOSITION =
  /(?:多镜头|多个镜头|自然切镜|切到|切换到|转场到|multiple\s+shots?|cut\s+to|montage|split[- ]screen|collage|contact\s+sheet|storyboard|grid\s+layout|multi[- ]panel|sequence\s+of\s+frames)/i;

function isNegativeConstraint(clause: string) {
  return /(?:禁止|不得|不允许|避免|不能|不要|no\s|without|avoid|must\s+not|do\s+not)/i.test(clause);
}

export function findUnsafeCompositionClauses(prompt: string) {
  return prompt
    .split(/(?<=[。；;.!?])|\n+/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .filter((clause) => !isNegativeConstraint(clause) && UNSAFE_POSITIVE_COMPOSITION.test(clause));
}

export function normalizeSingleCompositionPrompt(prompt: string, kind: "image" | "video") {
  const unsafeClauses = findUnsafeCompositionClauses(prompt);
  if (!unsafeClauses.length) return { prompt: prompt.trim(), rewritten: false, unsafeClauses };

  const unsafeSet = new Set(unsafeClauses);
  const retained = prompt
    .split(/(?<=[。；;.!?])|\n+/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .filter((clause) => !unsafeSet.has(clause));
  retained.push(
    kind === "image"
      ? "仅保留原提示中的主体、产品、场景、光线与材质语义，并将其组织为一个瞬间的一张完整画面。"
      : "仅保留原提示中的主体、产品、场景、光线与材质语义，并将简单微动作组织为同一时空中的连续动作链与一条连续运镜。"
  );
  return { prompt: retained.join("\n"), rewritten: true, unsafeClauses };
}

export function appendSingleFrameConstraint(prompt: string) {
  const normalized = normalizeSingleCompositionPrompt(prompt, "image");
  return [normalized.prompt, SINGLE_FRAME_HARD_CONSTRAINT_CN, SINGLE_FRAME_HARD_CONSTRAINT_EN].join("\n");
}

export function appendSingleVideoConstraint(prompt: string) {
  const normalized = normalizeSingleCompositionPrompt(prompt, "video");
  return [normalized.prompt, SINGLE_VIDEO_HARD_CONSTRAINT_CN, SINGLE_VIDEO_HARD_CONSTRAINT_EN].join("\n");
}
