import type { Metadata } from "next";

import { SiteVideoBackdrop } from "@/components/SiteVideoBackdrop";
import "./globals.css";
import "./auth.css";
import "./workspace-v3.css";
import "./cinema-system.css";

export const metadata: Metadata = {
  title: "AdDirector AI",
  description: "从商品简报到关键帧、主镜头与广告成片的一站式 AI 广告生成工作台。"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="anonymous" />
        <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap" rel="stylesheet" />
      </head>
      <body className="site-body">
        <SiteVideoBackdrop />
        {children}
      </body>
    </html>
  );
}
