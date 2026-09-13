import Link from "next/link";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";

export default function DemoPage() {
  return (
    <main className="account-page demo-index-page">
      <WorkspaceHeader active="工作台" projectHref="/demo/project" />
      <section className="account-page__content">
        <span>静态演示</span>
        <h1>低糖冷萃咖啡广告链路</h1>
        <p>这里仅展示静态产品流程，不调用真实模型、不上传素材，也不会启动视频渲染。</p>
        <div className="account-actions">
          <Link href="/generate">开始创作</Link>
          <Link href="/demo/project">查看项目</Link>
        </div>
        <div className="account-note">
          <strong>演示链路</strong>
          <p>广告需求 → DeepSeek 创意与分镜 → Qwen-Image 关键帧 → Wan 2.7 广告视频 → Remotion 成片。</p>
        </div>
      </section>
    </main>
  );
}
