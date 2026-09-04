import type { Metadata } from "next";

import "./globals.css";
import "./auth.css";
import "./workspace-v3.css";

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
      <body>{children}</body>
    </html>
  );
}
