"use client";

import { useEffect, useState } from "react";

const KEY = "ad-director-workspace-visit";
let initialization: Promise<boolean> | undefined;
let channel: BroadcastChannel | undefined;

async function initialize() {
  let visitId = sessionStorage.getItem(KEY);
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(KEY);
    if (!visitId) {
      visitId = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 400);
        channel!.onmessage = (event: MessageEvent) => {
          if (event.data?.type === "active" && typeof event.data.visitId === "string") {
            clearTimeout(timer); resolve(event.data.visitId);
          }
        };
        channel!.postMessage({ type: "probe" });
      });
    }
  }
  visitId ??= crypto.randomUUID();
  const response = await fetch("/api/workspace/visit", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ visitId })
  });
  const result = await response.json();
  if (!response.ok) { channel?.close(); throw new Error(result.error?.message ?? "工作台准备失败，请重试。"); }
  sessionStorage.setItem(KEY, visitId);
  if (channel) channel.onmessage = (event: MessageEvent) => {
    if (event.data?.type === "probe") channel?.postMessage({ type: "active", visitId });
  };
  if (result.data.reset) {
    const url = new URL(window.location.href);
    url.searchParams.delete("projectId");
    url.searchParams.delete("new");
    // Replace server-rendered project props after cleanup, without keeping a stale project URL in history.
    window.location.replace(url.toString());
    return false;
  }
  return true;
}

export function TemporaryWorkspaceGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    initialization ??= typeof navigator.locks !== "undefined"
      ? navigator.locks.request(KEY, initialize).then((value) => value)
      : initialize();
    void initialization.then((value) => { if (mounted) setReady(value); }).catch((cause: Error) => {
      initialization = undefined;
      if (mounted) setError(/[\u4e00-\u9fff]/.test(cause.message) ? cause.message : "无法准备临时工作台，请允许网站存储数据后重试。");
    });
    return () => { mounted = false; };
  }, []);
  if (ready) return children;
  return <main style={{ minHeight: "100dvh", display: "grid", placeContent: "center", textAlign: "center", gap: 16 }} aria-live="polite">
    <p>{error || "正在准备工作台"}</p>
    {error && <button type="button" onClick={() => window.location.reload()}>重试</button>}
  </main>;
}
