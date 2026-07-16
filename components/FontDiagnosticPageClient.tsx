"use client";

import dynamic from "next/dynamic";

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
    <main className="min-h-screen bg-[#05070c] px-6 py-12 text-white">
      <div className="mx-auto mb-6 max-w-6xl">
        <h1 className="text-2xl font-semibold">视频字体诊断</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          验证中文、英文、数字、标点和 400 / 500 / 700 三档本地字体。
        </p>
      </div>
      <FontDiagnosticPlayer />
    </main>
  );
}