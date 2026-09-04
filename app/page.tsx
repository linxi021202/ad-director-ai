"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { useState } from "react";

import { ModelSettingsSheet } from "@/components/ModelSettingsSheet";
import { ModelSettingsTrigger } from "@/components/model-settings/ModelSettingsTrigger";
import { useModelSettingsStatus } from "@/components/model-settings/useModelSettingsStatus";
import "./home-final.css";
import "./home-api-settings.css";

const projectPath = "/demo/project";

export default function HomePage() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const workspaceTarget = "/generate";
  const projectTarget = projectPath;
  const { status: modelStatus, setStatus: setModelStatus } = useModelSettingsStatus();

  const handleTransition = (target: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (isNavigating) return;
    setMenuOpen(false);
    setIsNavigating(true);
    window.setTimeout(() => router.push(target), 800);
  };

  const exitClass = isNavigating ? "home-is-exiting" : "";

  return (
    <main className="home-final">
      <header className={`home-header ${exitClass}`}>
        <div className="home-header-inner">
          <Link href="/" className="home-brand" aria-label="AdDirector AI 首页">
            <span className="home-brand-mark" aria-hidden="true"><i /></span>
            <span>AdDirector AI</span>
          </Link>

          <nav className="home-desktop-nav" aria-label="主要导航">
            <Link href="/" className="is-current">首页</Link>
            <Link href={workspaceTarget} onClick={handleTransition(workspaceTarget)}>工作台</Link>
            <Link href={projectTarget} onClick={handleTransition(projectTarget)}>项目</Link>
          </nav>

          <div className="home-header-actions">
            <ModelSettingsTrigger
              status={modelStatus}
              onClick={() => setSettingsOpen(true)}
              className="home-settings-button"
              label="模型设置"
            />
            <Link
              href={workspaceTarget}
              onClick={handleTransition(workspaceTarget)}
              className="home-open-button"
            >
              打开工作台
            </Link>
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
            <Link href={workspaceTarget} onClick={handleTransition(workspaceTarget)}>工作台</Link>
            <Link href={projectTarget} onClick={handleTransition(projectTarget)}>项目</Link>
            <button type="button" onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}>模型设置</button>
          </nav>
        ) : null}
      </header>

      <section className="home-hero">
        <div className={`home-hero-copy ${exitClass}`}>
          <h1>一份简报，直接成片。</h1>

          <div className="home-actions">
            <Link href={workspaceTarget} onClick={handleTransition(workspaceTarget)} className="home-primary-action">
              <span className="home-action-brand" aria-hidden="true"><i /></span>
              <span>开始生成广告</span>
              <span className="home-action-arrow" aria-hidden="true"><i /></span>
            </Link>
            <Link href={projectTarget} onClick={handleTransition(projectTarget)} className="home-secondary-action">
              <span className="home-play-icon" aria-hidden="true" />
              <span>查看演示项目</span>
              <span aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
      <ModelSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} status={modelStatus} onStatusChange={setModelStatus} />
    </main>
  );
}
