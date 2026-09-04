# Roadmap

## 当前已完成

- 匿名 HttpOnly Session 与 BYOK 密钥隔离。
- 匿名项目所有权和私有媒体资产。
- DeepSeek 结构化策略、分镜和提示词。
- Qwen-Image 单镜头与批量关键帧，支持部分成功。
- HappyHorse 单主镜头 API 与手动导入 fallback。
- Remotion 动态时间轴、旁白、字幕、卖点、CTA 和私有 MP4。
- 服务端 GenerationEvent 持久化、查询、脱敏和中断恢复。
- 生成页最近活动项目恢复。
- 新项目默认 40 秒、8 镜头；旧项目时长兼容。

## 当前默认方案

- 默认 8 镜头 × 5 秒；支持 3–12 镜头和 3–8 秒独立时长。
- 默认主镜头按当前分镜数量约 60% 的叙事位置动态选择，时长来自该镜头设置。
- Qwen-Image 按当前项目的真实分镜数量生成关键帧。
- HappyHorse 只生成 1 个主镜头视频。
- Remotion 合成完整广告。

## 后续工作

- 将本地私有文件迁移到对象存储。
- 将活跃渲染任务迁移到持久化队列。
- 增加自动清理、配额和可观察性。
- 增加真实部署环境下的恢复测试和 MP4 媒体探测。

## 不进入当前主链路

Seedance、小云雀、Wan、Kling、Hailuo、Vidu、Seedream、fal.ai、Fish Audio、OpenAI 和 Qwen 文本模型不属于当前 MVP 路由。
