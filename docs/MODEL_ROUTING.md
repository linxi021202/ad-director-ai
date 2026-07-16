# Model Routing

## Stage 2 Principle

The MVP main route is converged to:

```text
DeepSeek -> Qwen-Image -> HappyHorse -> Remotion
```

This keeps the demo understandable, affordable, and reliable for an interview setting. The product is positioned as a workflow console, not a collection of unrelated API calls.

## Why DeepSeek Owns Text Thinking

DeepSeek is responsible for strategy, storyboard, prompt generation, and ad scoring. These tasks require structured reasoning, JSON output, and consistent creative logic. Keeping text thinking in one model reduces style drift, debugging cost, and orchestration complexity.

Stage 2 only calls DeepSeek for real text generation. All DeepSeek outputs are parsed as JSON and validated by Zod. If validation fails, the provider retries once. If DeepSeek still fails, providerRouter falls back to mockTextProvider and exposes fallbackUsed plus fallbackReason.

## Why Qwen-Image Is Stage 3

Qwen-Image is reserved for Chinese keyframes and poster-like visual frames. It is important for the product direction, but image generation is not required to prove the Stage 2 text workflow. Therefore Stage 2 only returns a planned Qwen-Image node and prompt assets.

## Why HappyHorse Is Stage 4

Video generation is the biggest cost and stability risk. Stage 4 will generate or prepare only one Hero Shot, about 4-5 seconds. The rest of the ad uses keyframes plus Remotion image motion.

The planned video provider is always HappyHorse. The current stage prepares prompts and route trace only; it does not call a real video API.

## Why Remotion Is Stage 5

Remotion is reserved for final composition: subtitles, timing, image motion, hero-shot insertion, CTA, and fallback rendering. Stage 2 only returns planned render status and mock preview URLs.

## Why Not Wan/Kling/Hailuo/fal.ai in MVP

Wan, Kling, Hailuo, and fal.ai are excluded from the MVP main route because they add vendor complexity before the product logic is proven. Multiple video vendors would make cost estimates, failure states, and demo explanation harder. They remain roadmap candidates after the core workflow is stable.

## Cost-Aware Routing

- Lowest-cost demo mode: DeepSeek + Qwen-Image keyframes + HappyHorse-ready Hero Shot prompt + Remotion.
- Automated video mode: DeepSeek + Qwen-Image keyframes + HappyHorse real Hero Shot + Remotion.
- Max real video shots per run: 1.
- Max video duration per shot: 5 seconds.

## Fallback Logic

- DeepSeek failure: fallback to mockTextProvider, with fallbackUsed=true and fallbackReason.
- Image node unavailable: keep prompts and planned keyframes.
- Video node unavailable: use keyframes plus Remotion image motion.
- Render unavailable: show mock preview and planned render trace.

## Stage 3: Qwen-Image Is Now Active

Stage 3 promotes Qwen-Image from planned node to real keyframe provider. The text chain remains DeepSeek. Image generation is still server-side only and is triggered by `/api/generate-images`.

Routing behavior:

- `AI_MODE=real` and `ENABLE_REAL_IMAGE=true`: image routes use `qwenImageProvider`.
- `ENABLE_REAL_IMAGE=false`: image routes use `mockImageProvider`.
- Qwen-Image failure: fallback to placeholder keyframe, with `fallbackUsed=true` and a clear `fallbackReason`.
- Video and render nodes remain planned only.

Low-cost debugging uses `hero-only`, defaulting to Shot 3, so the PM can validate prompt quality without paying for all four frames. Full storyboard generation uses `all-shots`, capped by `MAX_IMAGES_PER_RUN` and never exceeding four shots.

Qwen-Image returns temporary image URLs, so the server downloads successful images into `public/generated/images/{projectId}/shot-N.png`. This local cache is only for local demos. Deployment should later replace it with OSS or another durable storage layer.

## Stage 4 Video Route

The fourth-stage route is intentionally HappyHorse-first:

1. DeepSeek: completed real text generation for strategy, storyboard, prompt, and scoring.
2. Qwen-Image: completed real keyframe generation.
3. HappyHorse video: planned model for the single Hero Shot.
4. Remotion: planned final composition layer.
5. Remotion: planned Stage 5 composition.

The MVP does not generate four videos because that would multiply cost, waiting time, failure modes, and explanation burden. One Hero Shot proves video capability while keyframes and Remotion motion complete the rest of the ad.

HappyHorse is represented by `HappyHorseVideoProvider`, but it returns `not-implemented` and never calls an external video API. Wan, Kling, Hailuo, and fal.ai remain outside the current main route.


