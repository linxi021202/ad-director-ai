import "server-only";

import { createPrivateAsset, deletePrivateAsset, getProjectAssetUrl } from "../assets/assetStore";
import { hasSupportedAudioSignature } from "../assets/media";
import { getAIConfig } from "../config/ai";
import { requireOwnedAnonymousProject, updateOwnedAnonymousProject } from "../projects/anonymousProjectStore";
import { generateNarrationPlan, shortenNarration } from "../providers/deepseekProvider";
import { resolveProviderApiKey } from "../secrets/resolver";
import { narrationPlanSchema, type GenerationProject, type NarrationBeat, type NarrationPlan } from "../schemas/project";
import { buildPartialNarrationPlan, needsNarrationShortening } from "./narrationPlan";

type CosyVoiceResponse = { output?: { audio?: { url?: string } }; code?: string; message?: string };
export type AutoNarrationResult =
  | { success: true; assetId: string; assetIds: string[]; publicUrl: string; script: string; model: string; plan: NarrationPlan }
  | { success: false; error: string };
const REQUEST_TIMEOUT_MS = 90_000;

export function buildNarrationScript(project: GenerationProject) {
  return (project.narrationPlan ?? buildPartialNarrationPlan(project)).beats.map((beat) => beat.text).join("。").replace(/。{2,}/g, "。");
}

export async function ensureAutoNarration(projectId: string, project: GenerationProject, sessionId?: string): Promise<AutoNarrationResult> {
  if (!sessionId) return { success: false, error: "匿名会话不可用，无法生成独立旁白资产。" };
  const apiKey = await resolveProviderApiKey("qwen-image", sessionId);
  if (!apiKey) return { success: false, error: "百炼密钥未配置，无法生成独立旁白资产。" };
  const config = getAIConfig({ allowSessionSecrets: true });
  const generatedPlan = project.narrationPlan ?? await resolveNarrationPlan(project, sessionId);
  if (generatedPlan.mode === "none" || generatedPlan.beats.length === 0) {
    return { success: false, error: "旁白计划未包含可生成的 Partial Narration Beat。" };
  }

  const completedBeats: NarrationBeat[] = [];
  const createdAssetIds: string[] = [];
  try {
    for (const beat of generatedPlan.beats) {
      let text = beat.text;
      let audio = await synthesizeBeat(text, apiKey, config.tts);
      if (needsNarrationShortening(audio.durationSec, beat.maxDurationSec)) {
        const shortened = await shortenNarration(text, beat.maxDurationSec, project.brief, { sessionId, maxProviderAttempts: 1 });
        if (!shortened.success || !shortened.data) throw new Error(`NARRATION_TOO_LONG:${beat.id}`);
        text = shortened.data.text;
        audio = await synthesizeBeat(text, apiKey, config.tts);
      }
      if (needsNarrationShortening(audio.durationSec, beat.maxDurationSec)) throw new Error(`NARRATION_TOO_LONG:${beat.id}`);
      const asset = await createPrivateAsset(sessionId, projectId, {
        kind: "narration-audio", source: "user-upload", role: `cosyvoice-beat-${beat.role}`,
        fileName: `${beat.id}.wav`, mimeType: "audio/wav", bytes: audio.bytes, durationSec: audio.durationSec
      });
      createdAssetIds.push(asset.id);
      completedBeats.push({ ...beat, text, displayText: text, assetId: asset.id, actualDurationSec: audio.durationSec });
    }

    const record = await requireOwnedAnonymousProject(sessionId, projectId);
    const previousIds = new Set([
      ...(record.project.narrationAssetId ? [record.project.narrationAssetId] : []),
      ...(record.project.narrationPlan?.beats.flatMap((beat) => beat.assetId ? [beat.assetId] : []) ?? [])
    ]);
    const plan = narrationPlanSchema.parse({ mode: "partial", beats: completedBeats });
    await updateOwnedAnonymousProject(sessionId, projectId, { narrationPlan: plan, narrationAssetId: createdAssetIds[0] });
    for (const previousId of previousIds) {
      if (!createdAssetIds.includes(previousId)) await deletePrivateAsset(sessionId, projectId, previousId).catch(() => undefined);
    }
    return {
      success: true, assetId: createdAssetIds[0]!, assetIds: createdAssetIds,
      publicUrl: getProjectAssetUrl(projectId, createdAssetIds[0]!), script: completedBeats.map((beat) => beat.text).join("。"),
      model: config.tts.model, plan
    };
  } catch (error) {
    for (const assetId of createdAssetIds) await deletePrivateAsset(sessionId, projectId, assetId).catch(() => undefined);
    const message = error instanceof Error ? error.message : "自动旁白生成失败";
    return { success: false, error: message.startsWith("NARRATION_TOO_LONG") ? "旁白缩短一次后仍超过镜头可用时长，已停止生成，未使用暴力倍速。" : `自动旁白生成失败：${sanitizeError(message)}` };
  }
}

async function resolveNarrationPlan(project: GenerationProject, sessionId: string) {
  const result = await generateNarrationPlan(project.brief, project.strategy, project.shots, { sessionId, maxProviderAttempts: 1 });
  return result.success && result.data ? result.data : buildPartialNarrationPlan(project);
}

async function synthesizeBeat(text: string, apiKey: string, tts: { baseUrl: string; model: string; voice: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${tts.baseUrl.replace(/\/$/, "")}/api/v1/services/audio/tts/SpeechSynthesizer`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: tts.model, input: { text, voice: tts.voice, format: "wav", sample_rate: 24000 } }), signal: controller.signal
    });
    const payload = await response.json().catch(() => ({})) as CosyVoiceResponse;
    const audioUrl = payload.output?.audio?.url;
    if (!response.ok || !audioUrl) throw new Error(payload.message || payload.code || `TTS_HTTP_${response.status}`);
    const audioResponse = await fetch(audioUrl, { signal: controller.signal, cache: "no-store" });
    if (!audioResponse.ok) throw new Error(`TTS_DOWNLOAD_${audioResponse.status}`);
    const bytes = new Uint8Array(await audioResponse.arrayBuffer());
    if (!hasSupportedAudioSignature(bytes, "audio/wav")) throw new Error("TTS_INVALID_AUDIO");
    const durationSec = wavDurationSec(bytes);
    if (!durationSec) throw new Error("TTS_DURATION_UNAVAILABLE");
    return { bytes, durationSec };
  } finally {
    clearTimeout(timeout);
  }
}

export function wavDurationSec(bytes: Uint8Array) {
  if (bytes.length < 44 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF") return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "data" && byteRate > 0) return chunkSize / byteRate;
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return 0;
}

function sanitizeError(message: string) {
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]+/gi, "[redacted]").slice(0, 120);
}
