# Frontend Design Context

## 项目背景

这是一个用于 AI 产品经理面试展示的 AIGC 广告视频生成 Web Demo，产品名为 **AdDirector AI / AI广告导演台**。目标不是做真实商业系统，而是在 10 天内落地一个可讲清楚的 MVP：用户输入商品 Brief 后，系统展示广告策略、4 镜头分镜、Prompt、模型路由、成本估算、生成进度、失败降级和最终视频预览。

当前主 Demo 场景是“低糖冷萃咖啡”，目标用户是一线城市上班族，输出为 9:16 竖版广告，18 秒，4 个镜头。

## 技术与功能限制

- Next.js App Router + TypeScript + Tailwind CSS + Zod。
- 不新增登录、支付、数据库。
- 不接真实图片/视频 API。
- 第二阶段只允许真实调用 DeepSeek 文本；Qwen-Image、Seedance/小云雀、Remotion 只展示计划状态。
- 不改数据结构、不改 Provider 抽象、不破坏现有 Mock fallback。
- 页面不能直接调用模型逻辑。

## 当前前端页面

重点页面：

- `app/page.tsx`：首页落地页
- `app/generate/page.tsx`：生成工作流页，实际 UI 在 `components/GenerateWorkflow.tsx`
- `app/projects/[id]/page.tsx`：项目详情页，实际 UI 在 `components/ProjectDetailView.tsx`
- 全局样式主要在 `app/globals.css`

## 最近的设计方向

用户明确不喜欢：

- “AI 味”很重的紫色/霓虹/玻璃卡片堆叠。
- 每个页面都重复展示同一张咖啡图片。
- 文字过大导致换行、错位、竖排。
- 分镜和 Prompt 信息密度太高。
- 只靠花哨背景，缺少产品逻辑层级。

当前希望的方向：

- 首页像“产品落地页 + 抽象驾驶舱”，不要咖啡图主视觉。
- 生成页像“流程工作台”，重点是 Brief 输入、生成链路、状态、成本、Trace。
- 项目详情页像“剪辑台 + 项目复盘页”，只保留一个最终视频预览，其余区域展示策略、时间线、模型路由、成本和降级。
- 深色科技感可以保留，但要克制、清晰、专业，适合面试演示。

## 希望重点评审的问题

请重点帮忙判断：

1. 首页是否能一眼看出这是“AI广告导演台”，而不是咖啡广告页。
2. 生成页未点击生成前是否足够美观、清楚、有任务感。
3. 项目详情页是否能在第一屏讲清楚：最终预览、策略、成本、路由、失败降级。
4. 是否还有文字挤压、错位、信息过密的问题。
5. 深色配色是否显得高级，而不是模板化 AI SaaS。
6. 是否需要调整布局优先级，让面试官更快理解“不是 API 套壳，而是多模型工作流产品”。

## 验证命令

```bash
npm run dev
npm run test
npm run build
```

如果是在 PowerShell 执行 npm 被策略拦截，可使用：

```bash
npm.cmd run dev
npm.cmd run test
npm.cmd run build
```
