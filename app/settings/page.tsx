import Link from "next/link";




export const dynamic = "force-dynamic";

export default async function SettingsPage() {


  return (
    <main className="account-page">
      <section className="account-page__content">
        <span>设置</span>
        <h1>模型设置</h1>
        <p>当前模型密钥只保存在服务端进程内，不会写入浏览器存储，也不能跨设备恢复。</p>
        <div className="account-actions">
          <Link href="/generate">进入工作台管理模型</Link>
          <Link href="/">返回首页</Link>
        </div>
      </section>
    </main>
  );
}