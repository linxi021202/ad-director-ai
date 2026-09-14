import type { AdStrategy, CreativeBible, CreativeDirection, ProductBrief, ProjectPlanningConstraints } from "@/lib/schemas/project";
import { buildCreativeBible } from "@/lib/continuity/projectContinuity";

export function buildCreativeDirectionsPrompt(brief: ProductBrief, constraints: ProjectPlanningConstraints): string {
  return `你是一名资深商业广告创意总监。只输出合法 JSON，不要 Markdown。
这是独立的 PASS A，只负责真正想创意，不生成分镜、图片提示词或视频提示词。
为同一个商品生成恰好 3 个真正不同、都可执行的广告创意方向。一句话创意要简洁，其余字段要提供足够具体的导演执行信息。
三套方案必须在 bigIdea、visualMetaphor、creativeMechanism、storyArc、heroMoment 和 endingIdea 上明显不同，不能只是改标题、同义改写或替换场景。
广告需求只是事实输入。每个方案必须通过 differenceFromBrief 明确说明新增了什么视觉表达机制，禁止复述商品名、受众、卖点和情绪词来冒充创意。
所有内容必须服务于真实产品，不得发明价格、折扣、认证、医学功效、排名或未提供的产品事实；不得要求 AI 生成可读包装文字，文字只在后期叠加。
广告需求：${JSON.stringify(brief)}
不可改写的制作约束：${JSON.stringify(constraints)}
返回：{"candidates":[{"id":"creative-1","title":"","oneLineIdea":"","audienceTension":"","coreInsight":"","bigIdea":"","creativeMechanism":"","visualMetaphor":"","storyArc":"","openingHook":"","productEntrance":"","visualHook":"","productRole":"","emotionalTurn":"","heroMoment":"","endingIdea":"","visualStyle":"","cameraLanguage":"","pacingStrategy":"","whyItWorks":"","differenceFromBrief":"","executionRisk":"","continuityStrategy":""}],"recommendedCandidateId":"creative-1"}
字段不得缺失。推荐项必须来自三个候选。`;
}

export type CreativeQualityIssue = {
  candidateId?: string;
  code: "too-shallow" | "weak-field" | "too-similar" | "brief-copy";
  message: string;
};

export function validateCreativeDirectionSetQuality(
  candidates: CreativeDirection[],
  brief?: ProductBrief
): { valid: boolean; issues: CreativeQualityIssue[] } {
  const issues = candidates.flatMap((candidate) => validateCreativeDepth(candidate, brief));
  const diversity = validateCreativeDiversity(candidates);
  if (!diversity.valid) issues.push({ code: "too-similar", message: diversity.reason ?? "三个方向需要更明显的差异。" });
  return { valid: issues.length === 0, issues };
}

export function validateCreativeDepth(candidate: CreativeDirection, brief?: ProductBrief): CreativeQualityIssue[] {
  const issues: CreativeQualityIssue[] = [];
  const detailedFields: Array<keyof CreativeDirection> = [
    "audienceTension", "coreInsight", "bigIdea", "creativeMechanism", "visualMetaphor", "storyArc",
    "openingHook", "productEntrance", "visualHook", "emotionalTurn", "heroMoment", "endingIdea",
    "visualStyle", "cameraLanguage", "pacingStrategy", "whyItWorks", "differenceFromBrief", "continuityStrategy"
  ];
  const detailLength = detailedFields.reduce((sum, field) => sum + normalizedLength(String(candidate[field])), 0);
  if (detailLength < 380) {
    issues.push({ candidateId: candidate.id, code: "too-shallow", message: `${candidate.title}的执行细节还不够充分。` });
  }
  for (const field of ["creativeMechanism", "storyArc", "heroMoment", "differenceFromBrief"] as const) {
    if (normalizedLength(candidate[field]) < 20) {
      issues.push({ candidateId: candidate.id, code: "weak-field", message: `${candidate.title}的${field}需要补充可执行细节。` });
    }
  }
  if (brief) {
    const briefPhrases = [brief.productName, brief.targetAudience, ...brief.sellingPoints]
      .map(normalizeText)
      .filter((value) => value.length >= 4);
    const difference = normalizeText(candidate.differenceFromBrief);
    if (briefPhrases.length > 0 && briefPhrases.filter((phrase) => difference.includes(phrase)).length >= Math.min(2, briefPhrases.length)) {
      issues.push({ candidateId: candidate.id, code: "brief-copy", message: `${candidate.title}需要提出新增创意，而不是复述广告需求。` });
    }
  }
  return issues;
}

export function buildDeepenCreativeDirectionsPrompt(
  brief: ProductBrief,
  constraints: ProjectPlanningConstraints,
  original: { candidates: CreativeDirection[]; recommendedCandidateId: string },
  issues: CreativeQualityIssue[]
): string {
  return `你是一名资深商业广告创意总监。只输出合法 JSON，不要 Markdown。
下面三套方向已经通过结构校验，但导演执行细节仍可加强。只深化原方向，不要改掉各自的核心机制，也不要新增或删除候选。
重点补足可拍摄的视觉动作、故事推进、产品高光、镜头语言和连续性策略；一句话创意继续保持简洁。不要虚构产品事实，不要要求生成可读文字。
广告需求：${JSON.stringify(brief)}
制作约束：${JSON.stringify(constraints)}
待深化方案：${JSON.stringify(original)}
需要改善：${JSON.stringify(issues.map((issue) => issue.message))}
返回与待深化方案完全相同的 JSON 结构，保留每个候选 id 和 recommendedCandidateId，字段不得缺失。`;
}

export function creativeDirectionToStrategy(direction: CreativeDirection, brief: ProductBrief): AdStrategy {
  return {
    audienceInsight: direction.audienceTension,
    painPoint: direction.audienceTension,
    coreMessage: direction.oneLineIdea,
    emotionalHook: direction.visualHook,
    bigIdea: direction.bigIdea,
    title: direction.title,
    subtitle: direction.oneLineIdea,
    cta: direction.endingIdea,
    emotionalArc: direction.emotionalTurn,
    narrativeArc: direction.storyArc,
    visualMetaphor: direction.visualMetaphor,
    visualStyle: direction.visualStyle,
    cameraLanguage: direction.cameraLanguage,
    pacing: direction.pacingStrategy,
    productImportance: "hero",
    commercialStructure: {
      hook: direction.visualHook,
      problem: direction.audienceTension,
      productReveal: direction.productRole,
      benefit: brief.sellingPoints.join("；"),
      emotionalPayoff: direction.emotionalTurn,
      cta: direction.endingIdea
    },
    forbiddenConcepts: ["虚构产品文字", "拼贴画面", "未经证实的功效或数据"]
  };
}

export function validateCreativeDiversity(candidates: CreativeDirection[]): { valid: boolean; reason?: string } {
  const fields: Array<keyof CreativeDirection> = ["bigIdea", "visualMetaphor", "storyArc", "heroMoment", "endingIdea"];
  for (const field of fields) {
    for (let left = 0; left < candidates.length; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        if (textSimilarity(String(candidates[left]![field]), String(candidates[right]![field])) > 0.68) {
          return { valid: false, reason: `三个创意方向的${field}过于相似。` };
        }
      }
    }
  }
  return { valid: true };
}

function normalizeText(value: string): string {
  return value.replace(/\s|[，。；、,.!！?？：:（）()]/g, "").toLowerCase();
}

function normalizedLength(value: string): number {
  return Array.from(normalizeText(value)).length;
}

function textSimilarity(left: string, right: string): number {
  const tokens = (value: string) => new Set(Array.from(value.replace(/\s|[，。；、,.!！?？：:]/g, "").toLowerCase()));
  const a = tokens(left);
  const b = tokens(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 1;
}

export function creativeDirectionToBible(direction: CreativeDirection, brief: ProductBrief): CreativeBible {
  return buildCreativeBible(brief, creativeDirectionToStrategy(direction, brief));
}
