# Roadmap

## Current Main Route

```text
DeepSeek -> Qwen-Image -> HappyHorse -> Remotion
```

The route is intentionally narrow so the 10-day solo MVP can remain understandable, testable, and demo-ready.

## Stage 2: Real Text Only

Status: current.

- DeepSeek real text generation for strategy, storyboard, prompt generation, and scoring.
- JSON output parsing.
- Zod validation.
- One retry on validation or JSON failure.
- Fallback to mockTextProvider.
- Trace UI for provider, model, latencyMs, tokenUsage, costEstimate, fallbackUsed, and fallbackReason.

No real image, video, or render API calls are made in Stage 2.

## Stage 3: Qwen-Image Keyframes

Planned scope:

- Connect Qwen-Image for keyframes and Chinese poster-like frames.
- Generate up to 4 keyframes per run.
- Keep cost limits and fallback to mock keyframes.
- Continue to avoid real video generation unless Stage 4 is active.

## Stage 4: HappyHorse Video

Planned scope:

- Generate or prepare only one Hero Shot.
- Hero Shot duration: 4-5 seconds.
- Support Shots remain Qwen-Image keyframes plus Remotion image motion.
- If the HappyHorse API is unstable or too expensive, keep keyframe motion as the fallback workflow.

## Stage 5: Remotion Final Composition

Planned scope:

- Compose 15-20 second final ad.
- Add subtitles, CTA, timing, music placeholder, image motion, and one Hero Shot video.
- Produce a real MP4 only after Stage 3 and Stage 4 inputs are stable.

## Future Vendor Exploration

The following vendors are not part of the MVP main route and should not appear in current routing UI or cost mainline:

- Wan
- Kling
- Hailuo
- Vidu
- Seedream
- fal.ai
- Fish Audio
- OpenAI
- Qwen text model

They may be evaluated later for quality benchmarking, backup routes, or enterprise customization. They are excluded now because they add cost, orchestration, and explanation complexity before the core product workflow is proven.

## Why One Real Video Shot

A full four-shot real-video pipeline is too expensive and unstable for a fast interview demo. One Hero Shot proves video capability. Keyframes plus Remotion motion complete the rest of the ad at lower cost.

## Release Gate

Every stage must pass:

```bash
npm test
npm run build
```

## Stage 3 Status: Qwen-Image Keyframes

Status: current.

- Qwen-Image real keyframe generation is connected through DashScope.
- `hero-only` generates one low-cost debug keyframe, defaulting to Shot 3.
- `all-shots` generates up to 4 keyframes and respects `MAX_IMAGES_PER_RUN`.
- Successful temporary URLs are cached locally under `public/generated/images/{projectId}/shot-N.png`.
- Failed shots fallback to placeholder images while successful shots remain usable.
- Product images are local CTA references only and are not sent to Qwen-Image.

Stage 4 remains HappyHorse for one real Hero Shot video. Stage 5 remains Remotion final composition.

## Stage 4 Status: One Hero Shot Video

Status: current implementation layer.

- `heroShotId` defaults to `shot-3`.
- Users can choose another storyboard shot as the Hero Shot.
- The Hero Shot shows the original video prompt and an optimized image-to-video prompt.
- Manual upload supports mp4, webm, and mov files up to 50MB through local object URL preview.
- `/demo-videos/hero-shot.mp4` can be used as a local demo asset.
- Failed video preparation can fallback to Hero Shot keyframe motion.
- HappyHorse Provider is reserved, returns `not-implemented`, and does not call a real video API.

Next: Stage 5 Remotion composition will combine keyframes, the Hero Shot video, subtitles, CTA, and fallback motion into a full ad preview.


