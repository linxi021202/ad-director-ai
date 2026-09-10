import { narrationPlanSchema, type GenerationProject, type NarrationBeat, type NarrationPlan } from "../schemas/project";

export function buildPartialNarrationPlan(project: GenerationProject): NarrationPlan {
  const first = project.shots[0]!;
  const ending = project.shots.at(-1)!;
  const middle = project.shots.length >= 3 ? project.shots[Math.floor(project.shots.length / 2)] : undefined;
  const beats: NarrationBeat[] = [{
    id: "narration-problem", shotId: first.id, role: "problem", text: concise(project.strategy.emotionalHook),
    tone: "克制、共情", maxDurationSec: availableDuration(first.durationSec), subtitleEnabled: true
  }];
  const supportedBenefit = project.brief.sellingPoints[0] ?? project.brief.verifiedClaims?.[0];
  if (middle && middle.id !== ending.id && supportedBenefit) {
    beats.push({
      id: "narration-benefit", shotId: middle.id, role: "benefit", text: concise(supportedBenefit), tone: "轻快、自然",
      maxDurationSec: availableDuration(middle.durationSec), subtitleEnabled: true
    });
  }
  beats.push({
    id: "narration-brand-payoff", shotId: ending.id, role: "brand-payoff",
    text: concise(`${project.brief.productName}，${project.strategy.cta}`), tone: "清晰、坚定",
    maxDurationSec: availableDuration(ending.durationSec), subtitleEnabled: true
  });
  return narrationPlanSchema.parse({ mode: "partial", beats });
}

export function needsNarrationShortening(actualDurationSec: number, maxDurationSec: number) {
  return actualDurationSec > maxDurationSec;
}

function availableDuration(shotDurationSec: number) {
  return Math.max(0.8, shotDurationSec - 0.4);
}

function concise(value: string) {
  return value.trim().replace(/[。！？]+$/g, "").slice(0, 48);
}
