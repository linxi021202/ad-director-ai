# AdDirector AI / AI 广告导演台

AdDirector AI 是一套可解释的 AIGC 广告生成工作台。主链路固定为：

```text
商品简报 -> DeepSeek -> Qwen-Image -> HappyHorse -> Remotion
```

新项目默认生成约 40 秒广告：8 个镜头，每个镜头默认 5 秒，总时长 40 秒。旧项目继续使用自身镜头数量与镜头时长，不会被自动扩展。

## 当前能力

- Next.js App Router、TypeScript、Tailwind CSS、Zod。
- 匿名 HttpOnly Session 隔离项目、BYOK 密钥和私有媒体资产。
- DeepSeek 生成策略、分镜、图片提示词和视频提示词；失败时保留 Mock fallback。
- Qwen-Image 支持单镜头或全部镜头关键帧生成，默认上限 12 张；结果立即下载到会话私有资产存储。
- HappyHorse 只生成一个 5–7 秒主镜头视频；真实 API 不可用时支持私有手动导入和关键帧动效降级。
- Remotion 根据项目实际镜头时长动态计算时间轴、帧数、字幕、卖点、旁白和 CTA，输出私有 MP4。
- 生成日志以 `GenerationEvent[]` 写入服务端 `project.json`，页面刷新、导航返回或同一会话重新打开后可恢复。

## 时长配置

统一配置位于 `lib/video/durationConfig.ts`：

- 新项目默认 40 秒、8 镜头、30fps、1200 帧。
- 分镜数量可设为 3–12 个；每个镜头可独立设置为 3–8 秒，总时长由镜头时长求和。
- 镜头数量与时长按所选方案动态生成。
- Remotion 不写死 1200 帧；实际帧数始终为 `sum(shots.durationSec) * fps`。
- 旧 15/18/20/30 秒项目按保存的镜头时长继续展示和渲染。

## 生成事件与恢复

每个项目最多保留 200 条结构化事件，包含阶段、Provider、状态、镜头、进度、耗时和脱敏错误码。日志不保存 API Key、Authorization、Session ID、渲染令牌、绝对路径或上游完整响应。

生成页恢复顺序：

1. URL 中明确的 `projectId`；
2. 当前匿名会话的 `lastActiveProjectId`；
3. 最近更新的项目；
4. 没有项目时才创建新项目。

显式新建使用 `/generate?new=1`。项目详情返回工作台时使用 `/generate?projectId={id}`。

## 私有存储

```text
storage/sessions/{sessionHash}/
  workspace.json
  projects/{projectId}/
    project.json
    assets.json
    assets/{assetId}/source-file.ext
storage/render-state/{projectId}.render.json
```

浏览器只获得所有权校验后的不透明资产 URL。Qwen 临时 URL 不会作为永久项目资产；Remotion 使用短期、限资产列表的内部渲染令牌读取输入。

## 环境与运行

将 `.env.example` 复制为 `.env.local`。所有密钥仅在服务端解析，禁止使用 `NEXT_PUBLIC_`。

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

## Railway 公测部署

仓库根目录包含生产 `Dockerfile`。公测阶段必须保持单实例，并把持久卷挂载到 `/app/storage`。服务端默认只允许一个 Remotion 渲染并发，其余任务进入有限队列；服务重启后，未完成任务会明确标记为中断并允许重试。

Railway 控制台配置、环境变量和首次验收步骤见 `docs/DEPLOY_RAILWAY.md`。面向多实例正式生产时，仍需将素材迁移到对象存储，并把渲染调度迁移到 Redis 等共享队列。
