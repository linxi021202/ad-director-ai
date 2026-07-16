# AdDirector AI / AI Advertising Director Console

A 10-day solo-buildable Web Demo for AI Product Manager interviews. The product demonstrates an AIGC ad-video workflow for one MVP scenario: low-sugar cold brew coffee for first-tier city office workers.

The demo is not an API wrapper. It is a multi-model workflow product that explains strategy, storyboard, prompts, planned model routing, cost control, fallback behavior, generation progress, and final vertical ad preview.

## MVP Scope

- Next.js App Router + TypeScript + Tailwind CSS + Zod.
- Main scenario: low-sugar cold brew coffee.
- Output target: Xiaohongshu/Douyin style 9:16 vertical short ad, 15-20 seconds, 4 shots.
- Stage 1: all mock providers.
- Stage 2: only DeepSeek real text generation is supported.
- Stage 2 does not call real image, video, or render APIs.

## Stage 2 Main Route

The main route is intentionally converged to:

```text
DeepSeek -> Qwen-Image -> HappyHorse -> Remotion
```

- DeepSeek: real text generation for strategy, storyboard, prompts, and ad scoring.
- Qwen-Image: planned Stage 3 keyframe generation, not called in Stage 2.
- HappyHorse: planned Stage 4 hero-shot video generation model. Current code prepares detailed DeepSeek video prompts but does not call a real video API yet.
- Remotion: planned Stage 5 final composition, not rendered in Stage 2.

Wan, Kling, Hailuo, and fal.ai are not part of the MVP main route because they increase model count, route complexity, cost uncertainty, and interview-demo risk. They stay in the roadmap as future exploration only.

## Why Only One Real Video Shot

The MVP controls cost by generating only one real Hero Shot video, around 4-5 seconds. The support shots use Qwen-Image keyframes plus Remotion image motion. Remotion later composes the full 15-20 second ad.

This keeps the demo practical for a 10-day solo project while still showing product-level thinking: cost-aware model routing, fallback design, and explainable generation.

## Environment

Copy `.env.example` to `.env.local` if you want to test real DeepSeek text mode.

```env
AI_MODE=mock
ENABLE_REAL_TEXT=false
ENABLE_REAL_IMAGE=false
ENABLE_REAL_VIDEO=false
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
```

For real text only:

```env
AI_MODE=real
ENABLE_REAL_TEXT=true
DEEPSEEK_API_KEY=your_key_here
```

Do not enable real image or video in Stage 2.

## Commands

```bash
npm install
npm run dev
npm test
npm run build
```

## Verification

The current test suite covers mock routing, real DeepSeek routing, JSON/Zod validation, invalid JSON handling, DeepSeek fallback to mock, planned image/video/render behavior, and API key non-leakage.

## Stage 3 Update: Qwen-Image Keyframes

Stage 3 adds real Qwen-Image keyframe generation only. It does not call HappyHorse video generation, Remotion rendering, or any video API.

- `ENABLE_REAL_IMAGE=false`: image generation uses `mockImageProvider` placeholders.
- `ENABLE_REAL_IMAGE=true`: server-side `qwenImageProvider` calls DashScope Qwen-Image.
- `hero-only`: generates one default debug keyframe, using Shot 3 as the low-cost Hero Shot candidate.
- `all-shots`: generates up to 4 keyframes, limited by `MAX_IMAGES_PER_RUN`.
- Qwen-Image temporary URLs are downloaded immediately to `public/generated/images/{projectId}/shot-N.png` for local demo stability.
- Uploaded product images are never sent to Qwen-Image; they are local preview assets reserved for Stage 5 Remotion CTA composition.

Why keyframes before video: keyframes are cheaper, easier to validate visually, and give the interview demo a concrete asset layer before the expensive video step. Stage 4 will add HappyHorse for one 4-5 second Hero Shot. Stage 5 will use Remotion to compose keyframes, one Hero Shot, subtitles, CTA, and fallback motion into a complete ad.

## Stage 4 Update: One Hero Shot Video

Stage 4 does not generate four real videos. The MVP only prepares one Hero Shot video because four-shot video generation is costly, slower to debug, and harder to explain in a short interview demo.

- `heroShotId` defaults to `shot-3` and can be changed in the project detail page.
- The selected Hero Shot exposes the original video prompt and an optimized image-to-video prompt.
- Current execution path prepares HappyHorse-ready Hero Shot prompts and optional local demo video assets.
- Uploaded videos are previewed through browser object URLs only. They are not uploaded to cloud storage and are not stored as base64.
- `/demo-videos/hero-shot.mp4` can be used as a local demo asset when placed under `public/demo-videos/hero-shot.mp4`.
- HappyHorse Provider is reserved as the future video interface and currently returns `not-implemented`.
- If video preparation fails, the workflow falls back to Hero Shot keyframe motion for later Remotion composition.

Keyframes remain important because they support the other three shots, provide a reliable visual fallback, and become the input layer for Stage 5 Remotion composition.


