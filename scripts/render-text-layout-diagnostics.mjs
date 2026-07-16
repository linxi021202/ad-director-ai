import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const root = process.cwd();
const outputDir = path.join(root, "public", "generated", "font-diagnostic", "aspect-ratios");
mkdirSync(outputDir, { recursive: true });

const browserExecutable = [
  process.env.REMOTION_BROWSER_EXECUTABLE,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
].filter(Boolean).find((candidate) => existsSync(candidate));

const serveUrl = await bundle({
  entryPoint: path.join(root, "remotion", "index.ts"),
  publicDir: path.join(root, "public")
});

const ratios = [
  { id: "9x16", aspectRatio: "9:16", width: 1080, height: 1920 },
  { id: "16x9", aspectRatio: "16:9", width: 1920, height: 1080 },
  { id: "1x1", aspectRatio: "1:1", width: 1080, height: 1080 }
];

for (const ratio of ratios) {
  const inputProps = {
    projectId: `text-layout-${ratio.id}`,
    width: ratio.width,
    height: ratio.height,
    fps: 30,
    durationInFrames: 840,
    aspectRatio: ratio.aspectRatio,
    shots: [1, 2, 3, 4].map((index) => ({
      id: `shot-${index}`,
      durationSec: [6, 7, 7, 8][index - 1],
      keyframeUrl: "/landing-cold-brew-hero.png",
      subtitle: "清醒续航，低糖不负担。 LOW SUGAR COLD BREW 2026",
      title: `镜头 ${index} · AdDirector AI`,
      keywords: ["低糖", "冷萃", "轻负担"]
    })),
    heroShotId: "shot-3",
    heroVideoUrl: "/landing-cold-brew-hero.png",
    productAssets: [{ url: "/landing-cold-brew-hero.png", role: "main-product" }],
    cta: "立即开启轻负担时刻 · NOW",
    brandName: "低糖冷萃咖啡 AdDirector AI"
  };

  const composition = await selectComposition({
    serveUrl,
    id: "AdDirectorFinal",
    inputProps,
    browserExecutable
  });

  await renderStill({
    composition,
    serveUrl,
    inputProps,
    frame: 45,
    output: path.join(outputDir, `${ratio.id}-subtitle.png`),
    imageFormat: "png",
    overwrite: true,
    browserExecutable
  });

  await renderStill({
    composition,
    serveUrl,
    inputProps,
    frame: 720,
    output: path.join(outputDir, `${ratio.id}-cta.png`),
    imageFormat: "png",
    overwrite: true,
    browserExecutable
  });
}

console.log(`Text layout diagnostic outputs: ${outputDir}`);
