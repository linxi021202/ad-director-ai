"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ModelSettingsSheet } from "@/components/ModelSettingsSheet";
import { ModelSettingsTrigger } from "@/components/model-settings/ModelSettingsTrigger";
import { useModelSettingsStatus } from "@/components/model-settings/useModelSettingsStatus";
import { ParticleTransitionOverlay } from "@/components/ParticleTransitionOverlay";
import { ProjectEntryDialog } from "@/components/projects/ProjectEntryDialog";
import { CallLogDrawer } from "@/components/workspace/CallLogDrawer";
import "./home-final.css";
import "./home-api-settings.css";

export default function HomePage() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectEntryOpen, setProjectEntryOpen] = useState(false);
  const navigationTimersRef = useRef<number[]>([]);
  const { status: modelStatus, setStatus: setModelStatus } = useModelSettingsStatus();

  useEffect(() => () => {
    navigationTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const startTransition = (target: string) => {
    if (isNavigating) return;
    router.prefetch(target);
    setMenuOpen(false);
    setProjectEntryOpen(false);
    setIsNavigating(true);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.dataset.workspaceReveal = "pending";
    window.sessionStorage.setItem("ad-director-workspace-reveal", "pending");
    navigationTimersRef.current.push(window.setTimeout(() => router.push(target), reducedMotion ? 280 : 1660));
    navigationTimersRef.current.push(window.setTimeout(() => {
      if (`${window.location.pathname}${window.location.search}` !== target) window.location.assign(target);
    }, 2450));
  };

  const exitClass = isNavigating ? "home-is-exiting" : "";

  return (
    <main className={`home-final${isNavigating ? " is-transitioning" : ""}`}>
      <header className={`home-header ${exitClass}`}>
        <div className="home-header-inner">
          <Link href="/" className="home-brand" aria-label="AdDirector AI 首页">
            <span className="home-brand-mark" aria-hidden="true"><i /></span>
            <span>AdDirector AI</span>
          </Link>

          <div className="home-header-actions">
            <CallLogDrawer />
            <ModelSettingsTrigger
              status={modelStatus}
              onClick={() => setSettingsOpen(true)}
              className="home-settings-button"
              label="模型设置"
            />
            <button type="button" onClick={() => setProjectEntryOpen(true)} className="home-open-button">
              打开工作台
            </button>
          </div>

          <button
            type="button"
            className="home-menu-button"
            aria-label={menuOpen ? "关闭导航菜单" : "打开导航菜单"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span /><span />
          </button>
        </div>

        {menuOpen ? (
          <nav className="home-mobile-nav" aria-label="移动端导航">
            <Link href="/" onClick={() => setMenuOpen(false)}>首页</Link>
            <button type="button" onClick={() => { setMenuOpen(false); setProjectEntryOpen(true); }}>工作台</button>
            <CallLogDrawer />
            <button type="button" onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}>模型设置</button>
          </nav>
        ) : null}
      </header>

      <section className="home-hero">
        <div className={`home-hero-copy ${exitClass}`}>
          <h1>上传商品信息，智能生成广告</h1>

          <div className="home-actions">
            <button type="button" onClick={() => setProjectEntryOpen(true)} className="home-primary-action">
              <span className="home-action-brand" aria-hidden="true"><i /></span>
              <span>开始制作广告</span>
              <span className="home-action-arrow" aria-hidden="true"><i /></span>
            </button>
          </div>
        </div>
      </section>
      <section className="home-process" aria-label="制作流程"><div><h2>制作流程</h2><ol>{["添加产品图片", "选择创意方向", "确认人物与场景", "制作分镜与视频"].map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></li>)}</ol></div></section>
      <ParticleTransitionOverlay active={isNavigating} />
      <ProjectEntryDialog open={projectEntryOpen} onClose={() => setProjectEntryOpen(false)}
        onEnter={(projectId) => startTransition(`/generate?projectId=${encodeURIComponent(projectId)}`)}
        onManage={() => router.push("/projects")} />
      <ModelSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} status={modelStatus} onStatusChange={setModelStatus} />
    </main>
  );
}
