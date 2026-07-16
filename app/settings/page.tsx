import Link from "next/link";

import { requirePageUser } from "@/lib/auth/requireUser";


export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePageUser("/settings");

  return (
    <main className="account-page">
      <section className="account-page__content">
        <span>设置</span>
        <h1>账号与模型设置</h1>
        <p>当前模型密钥只保存在服务端进程内，不会写入浏览器存储，也不能跨设备恢复。</p>
        <div className="account-actions">
          <Link href="/generate">进入工作台管理模型</Link>
          <Link href="/dashboard">返回 Dashboard</Link>
        </div>
      </section>
    </main>
  );
}