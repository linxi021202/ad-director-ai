import Link from "next/link";

export default function DemoPage() {
  return (
    <main className="account-page">
      <section className="account-page__content">
        <span>AdDirector AI 静态演示</span>
        <h1>低糖冷萃咖啡广告链路</h1>
        <p>这里仅展示静态产品流程，不调用真实模型、不上传素材，也不会启动视频渲染。</p>
        <div className="account-actions">
          <Link href="/sign-up?callbackUrl=%2Fgenerate">注册后开始创作</Link>
          <Link href="/sign-in?callbackUrl=%2Fprojects%2Fcoldbrew-demo-001">登录查看项目</Link>
        </div>
        <div className="account-note">
          <strong>演示链路</strong>
          <p>商品简报 → DeepSeek 策略与分镜 → Qwen-Image 关键帧 → HappyHorse 主镜头 → Remotion 成片。</p>
        </div>
      </section>
    </main>
  );
}