# Architecture

## 系统链路

```text
Browser
  -> Anonymous HttpOnly Session
  -> ownership-checked API Routes
  -> Provider Router
     -> DeepSeek text
     -> Qwen-Image keyframes
     -> HappyHorse hero video
     -> Remotion composition
  -> private project + asset storage
```

页面组件不直接调用模型 SDK，也不接触完整 API Key。

## 项目状态

匿名项目存储在 `storage/sessions/{sessionHash}/projects/{projectId}/project.json`。项目保存 Brief、策略、动态镜头、关键帧、主镜头视频、旁白、最终视频、工作流状态与 `generationEvents`。

`storage/sessions/{sessionHash}/workspace.json` 只保存最近活动项目 ID。生成页按“显式项目 -> 最近活动 -> 最近更新 -> 新建”的顺序恢复工作区。

## GenerationEvent

`lib/projects/generationEvents.ts` 提供：

- `appendGenerationEvent`
- `startGenerationEvent`
- `completeGenerationEvent`
- `failGenerationEvent`
- `updateGenerationEventProgress`
- `listGenerationEvents`
- `normalizeInterruptedEvents`

事件通过项目级写入队列和原子文件替换持久化。所有事件写入前脱敏，最多保留 200 条。长时间停留在 `running` 的事件在查询时变为 `interrupted`，不会伪装成完成。

查询接口为 `GET /api/projects/[projectId]/events`，只允许当前匿名会话读取自己的项目。浏览器不能提交正式事件正文或 Provider 状态。

## 动态广告时长

`lib/video/shotConfig.ts` 是镜头数量和时间轴规则的单一来源。新项目默认 8 个镜头、每镜 5 秒、30fps；镜头数量可设为 3–12 个，每镜可设为 3–8 秒。旧项目总时长继续取 `sum(shots.durationSec)`。

Remotion 逐镜头推进 cursor：

```text
from = cursor
durationInFrames = round(shot.durationSec * fps)
cursor += durationInFrames
composition duration = cursor
```

因此 40 秒默认项目为 1200 帧，但 1200 不是所有项目的固定值。

## 私有资产与渲染

产品图、Qwen 关键帧、HappyHorse 视频、旁白、背景音乐和最终 MP4 都存储在会话私有目录。资产接口同时校验 Session、项目所有权和项目资产引用关系。

Remotion 不读取浏览器 Cookie。服务端为单次渲染签发短期资产 allowlist token；完成或失败后撤销。最终 MP4 再导入私有资产存储。

## Provider 与降级

- DeepSeek：结构化策略、分镜、提示词；失败后使用 Mock fallback。
- Qwen-Image：按每个镜头的独立提示词生成关键帧；支持部分成功。
- HappyHorse：一个主镜头视频；API 不可用时手动导入或降级为关键帧动效。
- Remotion：动态时间轴、旁白、字幕、卖点与 CTA 合成。

当前架构不包含 Seedance、Wan、Kling、Hailuo 或 fal.ai。
