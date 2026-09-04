# Model Routing

## 当前主链路

```text
DeepSeek -> Qwen-Image -> HappyHorse -> Remotion
```

## DeepSeek

负责策略、分镜、图片提示词和视频提示词。输出必须为 JSON，并经 Zod 校验；解析或校验失败允许一次修复重试，仍失败则使用 Mock fallback。镜头数量、总时长和主镜头位置来自当前项目参数。

## Qwen-Image

负责所有非视频镜头的关键帧。`hero-only` 生成当前项目选择的主镜头关键帧；`all-shots` 按当前项目真实镜头数处理，最多 12 个，并受 `MAX_IMAGES_PER_RUN` 限制。每个镜头使用独立提示词和独立事件，失败不会阻断其他镜头。

供应商临时 URL 只用于传输。服务端验证并下载后保存为当前匿名会话的私有资产；远程临时 URL 不作为永久成功结果。

## HappyHorse

只生成一个主镜头视频。默认主镜头根据当前镜头数居中选择，用户可以改选；主镜头使用该镜头真实的 3–8 秒时长。输入包含真实产品参考图、主镜头关键帧和 DeepSeek 视频提示词。

API 不可用、额度不足或响应异常时，状态必须真实显示失败；可切换到私有手动导入，或最终由 Remotion 使用关键帧动效降级。

## Remotion

按项目实际镜头数组生成动态 Sequence。负责关键帧动效、主镜头视频、中文旁白、字幕、卖点关键词和 CTA，并输出私有 MP4。总帧数由镜头时长求和计算，不固定为 540 或 1200。

## 事件与 Trace

策略、分镜、提示词、关键帧、主镜头、旁白和合成 Route 都写入服务端 GenerationEvent。前端 Trace 读取项目事件，不使用 localStorage、sessionStorage 或固定 setTimeout 伪造完成状态。

## 降级规则

- DeepSeek 失败：Mock 文本 fallback。
- 单张关键帧失败：该镜头使用占位图，其他镜头继续。
- HappyHorse 失败：手动导入或关键帧动效。
- Remotion 失败：保留错误事件和可重试状态，不伪造最终视频。
