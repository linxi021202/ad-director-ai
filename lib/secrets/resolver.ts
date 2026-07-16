import { cookies } from "next/headers";

import { assertServerOnly } from "../server-only";
import { MODEL_SESSION_COOKIE } from "./session";
import { secretStore } from "./store";
import type { PublicSecretStatus, ResolvedSecret, SecretProvider } from "./types";

assertServerOnly("Secret resolver");

const envNames: Record<SecretProvider, "DEEPSEEK_API_KEY" | "DASHSCOPE_API_KEY" | "HAPPYHORSE_API_KEY"> = {
  deepseek: "DEEPSEEK_API_KEY",
  "qwen-image": "DASHSCOPE_API_KEY",
  happyhorse: "HAPPYHORSE_API_KEY"
};

export async function currentModelSessionId(): Promise<string | undefined> {
  try {
    return (await cookies()).get(MODEL_SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

async function getSessionSecret(sessionId: string, provider: SecretProvider) {
  return sessionId ? await secretStore.get(sessionId, provider) : null;
}

function getEnvSecret(provider: SecretProvider): ResolvedSecret {
  const primary = process.env[envNames[provider]]?.trim();
  if (primary) return { value: primary, source: "env", lastFour: primary.slice(-4) };

  if (provider === "happyhorse") {
    const dashscope = process.env.DASHSCOPE_API_KEY?.trim();
    if (dashscope) return { value: dashscope, source: "env", lastFour: dashscope.slice(-4) };
  }

  return { value: null, source: "none" };
}

export async function resolveProviderSecret(provider: SecretProvider, sessionId: string): Promise<ResolvedSecret> {
  const saved = await getSessionSecret(sessionId, provider);
  if (saved?.value) return { value: saved.value, source: "session", lastFour: saved.lastFour };

  if (provider === "happyhorse") {
    const dashscopeSessionSecret = await getSessionSecret(sessionId, "qwen-image");
    if (dashscopeSessionSecret?.value) {
      return { value: dashscopeSessionSecret.value, source: "session", lastFour: dashscopeSessionSecret.lastFour };
    }
  }

  return getEnvSecret(provider);
}

export async function resolveProviderApiKey(provider: SecretProvider, sessionId?: string): Promise<string | null> {
  const resolvedSessionId = sessionId ?? (await currentModelSessionId()) ?? "";
  return (await resolveProviderSecret(provider, resolvedSessionId)).value;
}

export async function getProviderSecretStatus(provider: SecretProvider, sessionId = ""): Promise<PublicSecretStatus> {
  const saved = await getSessionSecret(sessionId, provider);
  if (saved) return { configured: true, source: "session", lastFour: saved.lastFour, validated: saved.validated };

  if (provider === "happyhorse") {
    const dashscopeSessionSecret = await getSessionSecret(sessionId, "qwen-image");
    if (dashscopeSessionSecret) {
      return { configured: true, source: "session", lastFour: dashscopeSessionSecret.lastFour, validated: dashscopeSessionSecret.validated };
    }
  }

  const resolved = await resolveProviderSecret(provider, "");
  return resolved.value
    ? { configured: true, source: "env", lastFour: resolved.lastFour }
    : { configured: false, source: "none" };
}
