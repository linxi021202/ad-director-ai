"use client";

import { useEffect, useRef } from "react";

export function useKeyframeProjectRefresh(projectId: string, enabled: boolean, refresh: () => Promise<unknown>) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let pending = false;
    let closed = false;
    const update = async () => {
      if (closed || pending || document.visibilityState === "hidden") return;
      pending = true;
      try { await refreshRef.current(); } catch { /* Keep the last durable snapshot during transport errors. */ }
      finally { pending = false; }
    };
    void update();
    const onVisible = () => { if (document.visibilityState === "visible") void update(); };
    const timer = window.setInterval(() => void update(), 6000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", onVisible);
    return () => { closed = true; window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", onVisible); };
  }, [projectId, enabled]);
}
