"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProjectFromBrowser } from "@/lib/projects/createProjectClient";

export function CreateProjectButton({ className, children }: { className?: string; children: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const projectId = await createProjectFromBrowser();
      router.push(`/generate?projectId=${encodeURIComponent(projectId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "新建项目失败，请稍后重试。");
      setBusy(false);
    }
  }

  return <><button type="button" className={className} disabled={busy} onClick={() => void create()}>{busy ? "正在创建…" : children}</button>
    {error ? <p role="alert">{error}</p> : null}</>;
}
