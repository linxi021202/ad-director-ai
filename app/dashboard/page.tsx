import Link from "next/link";

import { requirePageUser } from "@/lib/auth/requireUser";


export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requirePageUser("/dashboard");

  return (
    <main className="account-page">
      <section className="account-page__content">
        <span>AdDirector AI</span>
        <h1>你好，{user.name}</h1>
        <p>从这里进入广告生成工作台，或查看当前演示项目。</p>
        <div className="account-actions">
          <Link href="/generate">进入工作台</Link>
          <Link href="/projects/coldbrew-demo-001">查看演示项目</Link>
          <Link href="/settings">模型设置</Link>
        </div>
        <div className="account-note">
          <strong>模型配置</strong>
          <p>模型密钥仍为本机进程内临时配置；项目数据迁移将在下一阶段完成。</p>
        </div>
      </section>
    </main>
  );
}