import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAIConfig } from "../config/ai";
import { resolveProviderApiKey } from "../secrets/resolver";
import type { GenerationProject } from "../schemas/project";
import { safeSegment } from "../render/renderStateStore";

type CosyVoiceResponse = { output?: { audio?: { url?: string } }; code?: string; message?: string };
export type AutoNarrationResult = { success: true; publicUrl: string; script: string; model: string } | { success: false; error: string };
const REQUEST_TIMEOUT_MS = 90_000;

export function buildNarrationScript(project: GenerationProject) {
  const sellingPoints = project.brief.sellingPoints.map((point) => point.replace(/[。！？]+$/g, "").trim()).filter(Boolean).slice(0, 3);
  const subtitles = project.shots.map((shot) => shot.subtitle.replace(/[。！？]+$/g, "").trim()).filter(Boolean);
  const parts = [project.strategy.emotionalHook, subtitles[0], sellingPoints.join("，"), subtitles[1], project.strategy.coreMessage, subtitles[2], subtitles[3], project.strategy.cta]
    .map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  const script = [...new Set(parts)].join("。").replace(/。{2,}/g, "。");
  return script.endsWith("。") ? script : script + "。";
}

export async function ensureAutoNarration(projectId: string, project: GenerationProject, sessionId?: string): Promise<AutoNarrationResult> {
  const apiKey = await resolveProviderApiKey("qwen-image", sessionId);
  if (!apiKey) return { success: false, error: "百炼密钥未配置，已保留主镜头原声。" };
  const config = getAIConfig({ allowSessionSecrets: true });
  const script = buildNarrationScript(project);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.tts.baseUrl.replace(/\/$/, "")}/api/v1/services/audio/tts/SpeechSynthesizer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: config.tts.model, input: { text: script, voice: config.tts.voice, format: "wav", sample_rate: 24000 } }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({})) as CosyVoiceResponse;
    const audioUrl = payload.output?.audio?.url;
    if (!response.ok || !audioUrl) {
      const detail = payload.message || payload.code || `HTTP ${response.status}`;
      return { success: false, error: `自动旁白生成失败：${sanitizeError(detail)}，已保留主镜头原声。` };
    }
    const audioResponse = await fetch(audioUrl, { signal: controller.signal });
    if (!audioResponse.ok) return { success: false, error: "自动旁白下载失败，已保留主镜头原声。" };
    const bytes = Buffer.from(await audioResponse.arrayBuffer());
    if (bytes.length === 0) return { success: false, error: "自动旁白文件为空，已保留主镜头原声。" };
    const safeProjectId = safeSegment(projectId);
    const outputDir = path.join(process.cwd(), "public", "generated", safeProjectId, "audio");
    const dataDir = path.join(process.cwd(), "data", "projects");
    const publicUrl = `/generated/${safeProjectId}/audio/voiceover.wav`;
    await mkdir(outputDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(outputDir, "voiceover.wav"), bytes);
    await writeFile(path.join(dataDir, `${safeProjectId}.narration.json`), JSON.stringify({
      projectId: safeProjectId, fileName: "AI 自动旁白.wav", mimeType: "audio/wav", sizeBytes: bytes.length,
      publicUrl, createdAt: new Date().toISOString(), source: "cosyvoice-auto", script
    }, null, 2), "utf8");
    return { success: true, publicUrl, script, model: config.tts.model };
  } catch (error) {
    return { success: false, error: error instanceof Error && error.name === "AbortError" ? "自动旁白生成超时，已保留主镜头原声。" : "自动旁白生成失败，已保留主镜头原声。" };
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeError(message: string) {
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]+/gi, "[redacted]").slice(0, 120);
}

