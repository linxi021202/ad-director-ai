# Demo Script

## 3-Minute Interview Demo

### 0:00-0:30 Positioning

"AdDirector AI is a 10-day solo-buildable AIGC ad-video workflow demo. It is not an API wrapper. It shows how an AI product manager thinks through brief intake, strategy, storyboard, prompt generation, model routing, cost control, fallback, and final ad preview."

Point to the AI Mode badge:

- Mock Mode means the whole loop uses coldBrewDemo fallback.
- Real Text Mode means strategy/storyboard/prompt/scoring can call DeepSeek.

### 0:30-1:20 Workflow

Show the fixed product scenario: low-sugar cold brew coffee for first-tier city office workers.

Explain the route:

```text
DeepSeek -> Qwen-Image -> HappyHorse -> Remotion
```

DeepSeek does the thinking. Qwen-Image is planned for keyframes in Stage 3. HappyHorse is planned for one Hero Shot in Stage 4. Remotion is planned for final composition in Stage 5.

### 1:20-2:10 Trace and Explainability

Open the model trace panel.

Explain that every real text call exposes provider, model, latencyMs, tokenUsage, costEstimate, fallbackUsed, and fallbackReason. If DeepSeek fails, the system falls back to mockTextProvider and still preserves a complete demo path.

### 2:10-3:00 Cost Strategy

Show the low-cost video strategy card:

- Hero Shot: HappyHorse generates 4-5 seconds.
- Support Shots: Qwen-Image keyframes plus Remotion image motion.
- Final Render: Remotion composes a 15-20 second ad.

Close with: "The product deliberately generates only one real video shot because video is the biggest cost and stability risk."

## 5-Minute Interview Demo

Add the API layer explanation:

- `/api/generate-strategy` validates ProductBrief and returns strategy + trace.
- `/api/generate-storyboard` validates brief + strategy and returns shots + trace.
- `/api/generate-assets` only returns planned prompts and assets. It does not call image/video APIs.
- `/api/render-video` only returns planned render status.

Then explain why not Wan/Kling/Hailuo/fal.ai:

"They are useful future options, but putting many video vendors in the MVP makes the route harder to explain, test, and cost-control. The interview demo needs to prove workflow design first."

## Likely Interview Questions

### Is this just an API wrapper?

No. The core value is workflow orchestration: structured schema, provider abstraction, JSON validation, trace, fallback, cost-aware routing, and staged vendor integration.

### Why only call DeepSeek in Stage 2?

Text is the control plane. If strategy, storyboard, prompts, and scoring are stable, later image/video work has a reliable input contract. Connecting image/video first would increase cost before the product logic is proven.

### Why only one real video shot?

Video generation is expensive and unstable. One Hero Shot is enough to show video capability, while support shots can be keyframes with Remotion motion. This gives a complete 15-20 second ad at controlled cost.

### When do Qwen-Image and HappyHorse arrive?

Qwen-Image arrives in Stage 3 for keyframes. HappyHorse arrives in Stage 4 for the single Hero Shot. Remotion arrives in Stage 5 for final composition.

### What happens if DeepSeek fails?

providerRouter falls back to mockTextProvider, sets fallbackUsed=true, and returns a clear fallbackReason. The demo remains presentable.

## Stage 3 Demo Add-on

When showing the project detail page, use this sequence after the text workflow:

1. Point out that DeepSeek has already produced strategy, storyboard, and prompts.
2. Click `生成 Hero Shot` to generate only one keyframe for low-cost debugging.
3. Explain that this validates prompt quality before paying for full visual generation.
4. Click `生成全部关键帧` only when you want to show the full Stage 3 asset layer.
5. In each StoryboardCard, show provider, model, latency, cache status, and fallback state.
6. Emphasize that product reference images stay local and will be used later in Remotion CTA composition, not sent to Qwen-Image.

Suggested line: `第三阶段我只接关键帧，不急着接视频。原因是图片成本低、反馈快，可以先验证 Prompt 和镜头构图；视频放到第四阶段，只生成一个 4-5 秒核心镜头。`

## Stage 4 Demo Talking Point

When showing the project detail page, explain that the product deliberately generates only one real video segment: the Hero Shot. The rest of the ad remains keyframe-driven, then Remotion will turn those frames into controlled motion.

Suggested line: “I do not generate four videos in the MVP because the product goal is explainable, low-cost delivery. The Hero Shot proves video quality; Qwen-Image keyframes and Remotion cover the remaining shots and fallback path.”

If asked why HappyHorse is used first: “HappyHorse is now the only video model in the MVP route. The current stage prepares detailed DeepSeek video prompts first, then a later stage can connect the real HappyHorse API.”



