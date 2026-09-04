import { ANONYMOUS_SESSION_MAX_AGE_SECONDS } from "@/lib/session/anonymousSessionShared";
import type { ConfigurableProvider, SecretRecord, SecretStore } from "./types";

type SessionSecrets = Partial<Record<ConfigurableProvider, SecretRecord>> & {
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

// TEMPORARY_IN_MEMORY_BY_ANONYMOUS_SESSION: credentials are process-local and expire with the anonymous session.
const globalSecretState = globalThis as typeof globalThis & {
  adDirectorSessionSecrets?: Map<string, SessionSecrets>;
};

const sessionSecrets = globalSecretState.adDirectorSessionSecrets ?? new Map<string, SessionSecrets>();
globalSecretState.adDirectorSessionSecrets = sessionSecrets;

export class InMemorySecretStore implements SecretStore {
  private getActiveSession(sessionId: string) {
    const current = sessionSecrets.get(sessionId);
    if (!current) return null;
    if (current.expiresAt <= Date.now()) {
      sessionSecrets.delete(sessionId);
      return null;
    }
    return current;
  }

  async get(sessionId: string, provider: ConfigurableProvider) {
    return this.getActiveSession(sessionId)?.[provider] ?? null;
  }

  async set(sessionId: string, provider: ConfigurableProvider, value: string) {
    const now = Date.now();
    const current = this.getActiveSession(sessionId);
    const record: SecretRecord = {
      value,
      lastFour: value.slice(-4),
      validated: false,
      updatedAt: now
    };
    sessionSecrets.set(sessionId, {
      ...current,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      expiresAt: now + ANONYMOUS_SESSION_MAX_AGE_SECONDS * 1000,
      [provider]: record
    });
    return record;
  }

  async delete(sessionId: string, provider: ConfigurableProvider) {
    const current = this.getActiveSession(sessionId);
    if (!current) return;
    delete current[provider];
    current.updatedAt = Date.now();
    const hasSecrets = ["deepseek", "qwen-image"].some((candidate) => Boolean(current[candidate as ConfigurableProvider]));
    hasSecrets ? sessionSecrets.set(sessionId, current) : sessionSecrets.delete(sessionId);
  }

  async setValidated(sessionId: string, provider: ConfigurableProvider, validated: boolean) {
    const session = this.getActiveSession(sessionId);
    const current = session?.[provider];
    if (!session || !current) return;
    const now = Date.now();
    sessionSecrets.set(sessionId, {
      ...session,
      updatedAt: now,
      [provider]: { ...current, validated, validatedAt: now, updatedAt: now }
    });
  }

  async deleteSession(sessionId: string) {
    sessionSecrets.delete(sessionId);
  }

  async clear() {
    sessionSecrets.clear();
  }
}

export const secretStore: SecretStore = new InMemorySecretStore();