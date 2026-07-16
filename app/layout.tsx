import type { Metadata } from "next";

import "./globals.css";
import "./auth.css";
import "./workspace-v3.css";

export const metadata: Metadata = {
  title: "AIGC 广告视频生成 Demo",
  description: "Mock-first AIGC advertising video workflow demo."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}