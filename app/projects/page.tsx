import Link from "next/link";

import { requirePageUser } from "@/lib/auth/requireUser";


export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  await requirePageUser("/projects");

  return (
    <main className="account-page">
      <section className="account-page__content">
        <span>项目</span>
        <h1>当前演示项目</h1>
        <p>项目数据库迁移尚未开始，本阶段继续保留现有本地演示数据。</p>
        <div className="account-actions">
          <Link href="/projects/coldbrew-demo-001">打开低糖冷萃咖啡项目</Link>
          <Link href="/generate">返回工作台</Link>
        </div>
      </section>
    </main>
  );
}