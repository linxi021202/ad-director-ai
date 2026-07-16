# Codex Tasks

## Ground Rules

Codex must keep the MVP focused. Do not add login, payment, database, multi-user features, real image APIs, real video APIs, or real render jobs before their planned stage.

Codex must not put Wan, Kling, Hailuo, or fal.ai into the MVP main route. These vendors can only appear in roadmap discussion.

## Current Stage: Stage 2

Goal: real DeepSeek text generation with mock fallback.

Acceptance criteria:

- `AI_MODE=mock` uses mockTextProvider.
- `AI_MODE=real` and `ENABLE_REAL_TEXT=true` use deepseekProvider for strategy, storyboard, prompts, and scoring.
- All DeepSeek output is JSON parsed and Zod validated.
- DeepSeek failure falls back to mockTextProvider with fallbackUsed and fallbackReason.
- No real HappyHorse video or Remotion render calls.
- `npm test` passes.
- `npm run build` passes.

## Daily Task Plan

### Day 1: Project Skeleton

Deliver pages, components, mock data folders, schemas, provider folders, and docs skeleton.

### Day 2: Mock Workflow

Deliver coldBrewDemo, mock providers, model routing, cost cards, and video preview placeholder.

### Day 3: UI Demo Quality

Improve hierarchy, video preview prominence, storyboard density, prompt accordion, and model route visualization.

### Day 4: Route Convergence

Converge main route to DeepSeek + Qwen-Image + HappyHorse + Remotion. Move other vendors to roadmap only.

### Day 5: Real Text Foundation

Add env config, OpenAI-compatible LLM client, JSON utilities, DeepSeek provider, retry, validation, and mock fallback.

### Day 6: API Routes

Add generate-strategy, generate-storyboard, generate-assets, and render-video routes. Ensure unified API response and no key leakage.

### Day 7: Trace UI

Expose AI Mode badge, model trace, fallback state, and low-cost video strategy card.

### Day 8: Tests and Docs

Add tests for mock/real/fallback, valid/invalid JSON, planned image/video/render behavior, and API key non-leakage. Update README and docs.

### Day 9: Stage 3 Preparation

Prepare Qwen-Image adapter interface only. Do not call the API until explicitly requested.

### Day 10: Demo Rehearsal

Polish demo script, verify build, and prepare interview narration.

## Do Not Modify Without Explicit Request

- Authentication.
- Payment.
- Database persistence.
- Real image generation.
- Real video generation.
- Real Remotion rendering.
- Vendor expansion into the MVP main route.
- Secrets committed to source code.


