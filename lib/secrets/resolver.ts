import { assertServerOnly } from "../server-only";
import { getAnonymousSession } from "../session/anonymousSession";
import { secretStore } from "./store";
import type {
  ConfigurableProvider,
  PublicSecretStatus,
  ResolvedSecret,
  SecretProvider
} from "./types";

assertServerOnly("Secret resolver");

const envNames: Record<ConfigurableProvider, "DEEPSEEK_API_KEY" | "DASHSCOPE_API_KEY"> = {
  deepseek: "DEEPSEEK_API_KEY",
  "qwen-image": "DASHSCOPE_API_KEY"
};

export async function currentModelSessionId(): Promise<string | undefined> {
  try {
    return (await getAnonymousSession())?.id;
  } catch {
    return undefined;
  }
}

async function getSessionSecret(sessionId: string, provider: ConfigurableProvider) {
  return sessionId ? await secretStore.get(sessionId, provider) : null;
}

export function platformKeysAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_PLATFORM_KEYS === "true";
}

function providerNotConfigured(provider: ConfigurableProvider): ResolvedSecret {
  return {
    value: null,
    source: "none",
    code: "PROVIDER_NOT_CONFIGURED",
    message: provider === "deepseek"
      ? "请先配置 DeepSeek API Key。"
      : "请先配置 Qwen-Image API Key。"
  };
}

function getEnvSecret(provider: ConfigurableProvider): ResolvedSecret {
  if (!platformKeysAllowed()) return providerNotConfigured(provider);
  const primary = process.env[envNames[provider]]?.trim();
  if (primary) return { value: primary, source: "env", lastFour: primary.slice(-4) };
  return providerNotConfigured(provider);
}

export async function resolveSessionProviderSecret(input: {
  sessionId: string;
  provider: ConfigurableProvider;
}): Promise<ResolvedSecret> {
  const { sessionId, provider } = input;
  const saved = await getSessionSecret(sessionId, provider);
  if (saved?.value) return { value: saved.value, source: "session", lastFour: saved.lastFour };
  return getEnvSecret(provider);
}

export async function resolveProviderSecret(provider: SecretProvider, sessionId: string): Promise<ResolvedSecret> {
  if (provider === "happyhorse") {
    const resolved = await resolveSessionProviderSecret({ sessionId, provider: "qwen-image" });
    return resolved.value
      ? resolved
      : {
          ...resolved,
          message: "请先配置百炼 DashScope API Key；Qwen-Image 与 HappyHorse 共用该密钥。"
        };
  }
  return resolveSessionProviderSecret({ sessionId, provider });
}

export async function resolveProviderApiKey(provider: SecretProvider, sessionId?: string): Promise<string | null> {
  const resolvedSessionId = sessionId ?? (await currentModelSessionId()) ?? "";
  return (await resolveProviderSecret(provider, resolvedSessionId)).value;
}

export async function getProviderSecretStatus(
  provider: ConfigurableProvider,
  sessionId = ""
): Promise<PublicSecretStatus> {
  const saved = await getSessionSecret(sessionId, provider);
  if (saved) {
    return {
      configured: true,
      source: "session",
      lastFour: saved.lastFour,
      validated: saved.validated
    };
  }
  return { configured: false, source: "none" };
}
