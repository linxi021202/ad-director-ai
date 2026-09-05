"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent } from "react";
import { useState } from "react";

import { ModelSettingsSheet } from "@/components/ModelSettingsSheet";
import { ModelSettingsTrigger } from "@/components/model-settings/ModelSettingsTrigger";
import { useModelSettingsStatus } from "@/components/model-settings/useModelSettingsStatus";
import "./home-final.css";
import "./home-api-settings.css";

const transitionParticles = Array.from({ length: 64 }, (_, index) => ({
  angle: `${index * 137.5}deg`,
  distance: `${30 + (index % 9) * 4.5}vmax`,
  delay: `${(index % 12) * 42}ms`,
  size: `${2 + (index % 3)}px`
}));

export default function HomePage() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const workspaceTarget = "/generate";
  const { status: modelStatus, setStatus: setModelStatus } = useModelSettingsStatus();

  const handleTransition = (target: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (isNavigating) return;
    setMenuOpen(false);
    setIsNavigating(true);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => router.push(target), reducedMotion ? 180 : 1320);
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
          </div>
        </div>
      </section>
      <div className={`home-route-transition${isNavigating ? " is-active" : ""}`} aria-hidden="true">
        <div className="home-route-transition__core" />
        {transitionParticles.map((particle, index) => (
          <i
            key={index}
            style={{
              "--particle-angle": particle.angle,
              "--particle-distance": particle.distance,
              "--particle-delay": particle.delay,
              "--particle-size": particle.size
            } as CSSProperties}
          />
        ))}
      </div>
      <ModelSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} status={modelStatus} onStatusChange={setModelStatus} />
    </main>
  );
}
