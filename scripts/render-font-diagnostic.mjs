import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const root = process.cwd();
const outputDir = path.join(root, "public", "generated", "font-diagnostic");
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
const composition = await selectComposition({ serveUrl, id: "FontDiagnostic", browserExecutable });

await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: path.join(outputDir, "font-diagnostic.mp4"),
  overwrite: true,
  browserExecutable
});

await renderStill({
  composition,
  serveUrl,
  frame: 60,
  output: path.join(outputDir, "font-diagnostic.png"),
  imageFormat: "png",
  overwrite: true,
  browserExecutable
});

console.log(`Font diagnostic outputs: ${outputDir}`);
