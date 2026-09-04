"use client";

import { useEffect, useState } from "react";
import UnicornScene from "unicornstudio-react/next";

type UnicornHeroBackgroundProps = {
  isNavigating?: boolean;
};

export function UnicornHeroBackground({ isNavigating = false }: UnicornHeroBackgroundProps) {
  const [isCompact, setIsCompact] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [sceneState, setSceneState] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    const compactQuery = window.matchMedia("(max-width: 767px)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncPreferences = () => {
      setIsCompact(compactQuery.matches);
      setPrefersReducedMotion(motionQuery.matches);
    };

    syncPreferences();
    compactQuery.addEventListener("change", syncPreferences);
    motionQuery.addEventListener("change", syncPreferences);

    return () => {
      compactQuery.removeEventListener("change", syncPreferences);
      motionQuery.removeEventListener("change", syncPreferences);
    };
  }, []);

  return (
    <div
      className={`home-unicorn-background is-${sceneState}${isNavigating ? " is-exiting" : ""}`}
      aria-hidden="true"
    >
      <div className="home-unicorn-fallback" />
      <div className="home-unicorn-stage">
        <UnicornScene
          projectId="KJp4lTw9pzaADDxFO3qB"
          width="100%"
          height="100%"
          scale={isCompact ? 0.72 : 1}
          dpi={isCompact ? 1 : 1.5}
          fps={isCompact ? 30 : 60}
          paused={isNavigating || prefersReducedMotion}
          lazyLoad={false}
          production
          placeholder={<div className="home-unicorn-placeholder" />}
          showPlaceholderWhileLoading
          showPlaceholderOnError
          onLoad={() => setSceneState("ready")}
          onError={() => setSceneState("fallback")}
        />
      </div>
      <div className="home-unicorn-scrim" />
    </div>
  );
}
