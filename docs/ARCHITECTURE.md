# Architecture

## System Overview

AdDirector AI is a Next.js App Router demo for an AIGC ad-video workflow. The system is intentionally small enough for a 10-day solo MVP but structured like a real multi-model product.

```text
UI Pages
  -> API Routes
    -> providerRouter
      -> DeepSeek Provider for real text
      -> Mock Providers for fallback
      -> Planned image/video/render nodes
```

## Frontend Modules

- `app/page.tsx`: landing/workbench preview.
- `app/generate/page.tsx`: generation workflow demo.
- `app/projects/[id]/page.tsx`: project detail view.
- `components/ModelTracePanel.tsx`: Stage 2 trace display.
- `components/LowCostVideoStrategyCard.tsx`: one-hero-shot cost strategy.
- `components/AIModeBadge.tsx`: Mock Mode / Real Text Mode indicator.

The pages do not directly call model APIs. They display mock data, planned route data, or API trace data.

## API Routes

- `app/api/generate-strategy/route.ts`: validates ProductBrief and returns strategy + trace.
- `app/api/generate-storyboard/route.ts`: validates brief + strategy and returns shots + trace.
- `app/api/generate-assets/route.ts`: returns prompts, recommendedModel, fallbackPlan, and planned assets. It does not call Qwen-Image or HappyHorse.
- `app/api/render-video/route.ts`: returns HappyHorse/Remotion planned status. It does not render MP4.

All API responses use:

```ts
{
  success,
  data,
  trace,
  fallbackUsed,
  fallbackReason,
  error
}
```

API responses must not expose API key values or full environment variables.

## Provider Abstraction

- `lib/providers/types.ts`: shared provider types.
- `lib/providers/mockTextProvider.ts`: Stage 1 and fallback text data.
- `lib/providers/deepseekProvider.ts`: real Stage 2 text provider.
- `lib/providers/providerRouter.ts`: mode-aware routing and fallback.

`AI_MODE=mock` uses mockTextProvider. `AI_MODE=real` with `ENABLE_REAL_TEXT=true` uses deepseekProvider for text tasks. If DeepSeek fails, providerRouter falls back to mockTextProvider.

## LLM Layer

- `lib/llm/openaiCompatibleClient.ts`: OpenAI-compatible DeepSeek chat-completions client.
- `lib/llm/jsonUtils.ts`: JSON parsing and markdown code-fence cleanup.
- `lib/llm/costEstimate.ts`: rough text cost estimate.
- `lib/llm/types.ts`: unified LLM request/response types.

The LLM layer only supports DeepSeek text generation in Stage 2.

## Mock to Real Replacement Path

1. Stage 1: all mock providers.
2. Stage 2: real DeepSeek text only.
3. Stage 3: connect Qwen-Image keyframe generation.
4. Stage 4: connect HappyHorse API for the single Hero Shot.
5. Stage 5: connect Remotion final render.

## Remotion Later

Remotion should receive the validated project plan: shots, keyframe URLs, one hero-shot video URL, subtitles, CTA, and fallback settings. Stage 2 only returns planned render status to keep build and demo risk low.

## Stage 3 Architecture Update

The image layer now has a real provider path:

```text
Project Detail UI -> /api/generate-images -> providerRouter -> qwenImageProvider -> qwenImageClient -> DashScope Qwen-Image
```

The provider saves returned temporary images through `downloadImage.ts` into `public/generated/images/{projectId}/shot-N.png`, then returns both remote and local URLs. If caching fails, the API still returns the remote URL with `cacheStatus=remote-only`.

Boundary rules:

- Qwen-Image receives text prompts only.
- Product upload previews are not converted to base64, not sent to DashScope, and not uploaded to third parties.
- No video provider is called in Stage 3.
- Remotion remains a planned Stage 5 composition step.

Partial success is supported: if one shot fails, other generated keyframes are still returned and failed shots are listed separately.

## Stage 4 Hero Shot Video State

Hero Shot video is managed as client-side project state, not as a real video generation backend. The supported states are `not-started`, `prompt-ready`, `waiting-manual-upload`, `uploaded`, `using-demo-asset`, `failed`, and `fallback-to-keyframe`.

Manual upload uses browser object URLs for preview. Files are not uploaded to cloud storage, not converted to base64, and not stored in a database. The local demo asset path is `/demo-videos/hero-shot.mp4`, resolved from `public/demo-videos/hero-shot.mp4`.

`lib/providers/happyHorseVideoProvider.ts` reserves the future automation interface. It implements the video provider shape but returns `not-implemented`, so the architecture can evolve without changing the current cost-controlled MVP behavior.

Stage 5 will use Remotion to combine Qwen-Image keyframes, one Hero Shot video, subtitles, CTA, and fallback image motion into the final 15-20 second ad.


