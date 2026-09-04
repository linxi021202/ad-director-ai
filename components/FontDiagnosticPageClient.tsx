"use client";

import dynamic from "next/dynamic";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";

const FontDiagnosticPlayer = dynamic(
  () => import("./FontDiagnosticPlayer").then((module) => module.FontDiagnosticPlayer),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto aspect-video w-full max-w-6xl animate-pulse rounded-2xl border border-white/10 bg-zinc-950" />
    )
  }
);

export function FontDiagnosticPageClient() {
  return (
    <main className="font-diagnostic-page min-h-screen text-white">
      <WorkspaceHeader active="设置" projectHref="/projects" />
      <div className="font-diagnostic-page__content mx-auto max-w-6xl">
        <div className="mb-6">
        <h1 className="text-2xl font-semibold">视频字体诊断</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          验证中文、英文、数字、标点和 400 / 500 / 700 三档本地字体。
        </p>
        </div>
        <FontDiagnosticPlayer />
      </div>
    </main>
  );
}
