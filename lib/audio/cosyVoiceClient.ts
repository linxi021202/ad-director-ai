import "server-only";

import { createPrivateAsset, deletePrivateAsset, getProjectAssetUrl } from "../assets/assetStore";
import { hasSupportedAudioSignature } from "../assets/media";
import { getAIConfig } from "../config/ai";
import { requireOwnedAnonymousProject, updateOwnedAnonymousProject } from "../projects/anonymousProjectStore";
import { resolveProviderApiKey } from "../secrets/resolver";
import type { GenerationProject } from "../schemas/project";

type CosyVoiceResponse = { output?: { audio?: { url?: string } }; code?: string; message?: string };
export type AutoNarrationResult =
  | { success: true; assetId: string; publicUrl: string; script: string; model: string }
  | { success: false; error: string };
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
  if (!sessionId) return { success: false, error: "匿名会话不可用，已保留主镜头原声。" };
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
    const audioResponse = await fetch(audioUrl, { signal: controller.signal, cache: "no-store" });
    if (!audioResponse.ok) return { success: false, error: "自动旁白下载失败，已保留主镜头原声。" };
    const bytes = new Uint8Array(await audioResponse.arrayBuffer());
    if (!hasSupportedAudioSignature(bytes, "audio/wav")) {
      return { success: false, error: "自动旁白文件格式无效，已保留主镜头原声。" };
    }

    const record = await requireOwnedAnonymousProject(sessionId, projectId);
    const previousAssetId = record.project.narrationAssetId;
    const asset = await createPrivateAsset(sessionId, projectId, {
      kind: "narration-audio",
      source: "user-upload",
      role: "cosyvoice-auto",
      fileName: "AI 自动旁白.wav",
      mimeType: "audio/wav",
      bytes
    });
    try {
      await updateOwnedAnonymousProject(sessionId, projectId, { narrationAssetId: asset.id });
    } catch (error) {
      await deletePrivateAsset(sessionId, projectId, asset.id);
      throw error;
    }
    if (previousAssetId && previousAssetId !== asset.id) {
      await deletePrivateAsset(sessionId, projectId, previousAssetId).catch(() => undefined);
    }
    return {
      success: true,
      assetId: asset.id,
      publicUrl: getProjectAssetUrl(projectId, asset.id),
      script,
      model: config.tts.model
    };
  } catch (error) {
    return { success: false, error: error instanceof Error && error.name === "AbortError" ? "自动旁白生成超时，已保留主镜头原声。" : "自动旁白生成失败，已保留主镜头原声。" };
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeError(message: string) {
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]+/gi, "[redacted]").slice(0, 120);
}
