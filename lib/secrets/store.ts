import type { ConfigurableProvider, SecretRecord, SecretStore } from "./types";

type SessionSecrets = Partial<Record<ConfigurableProvider, SecretRecord>>;

// TEMPORARY_IN_MEMORY_BY_USER_ID: credentials are process-local and are not cross-device durable.
const globalSecretState = globalThis as typeof globalThis & {
  adDirectorSessionSecrets?: Map<string, SessionSecrets>;
};

const sessionSecrets = globalSecretState.adDirectorSessionSecrets ?? new Map<string, SessionSecrets>();
globalSecretState.adDirectorSessionSecrets = sessionSecrets;

export class InMemorySecretStore implements SecretStore {
  async get(ownerId: string, provider: ConfigurableProvider) {
    return sessionSecrets.get(ownerId)?.[provider] ?? null;
  }

  async set(ownerId: string, provider: ConfigurableProvider, value: string) {
    const record: SecretRecord = {
      value,
      lastFour: value.slice(-4),
      validated: false,
      updatedAt: new Date().toISOString()
    };
    sessionSecrets.set(ownerId, { ...sessionSecrets.get(ownerId), [provider]: record });
    return record;
  }

  async delete(ownerId: string, provider: ConfigurableProvider) {
    const current = sessionSecrets.get(ownerId);
    if (!current) return;
    delete current[provider];
    Object.keys(current).length === 0 ? sessionSecrets.delete(ownerId) : sessionSecrets.set(ownerId, current);
  }

  async setValidated(ownerId: string, provider: ConfigurableProvider, validated: boolean) {
    const current = sessionSecrets.get(ownerId)?.[provider];
    if (!current) return;
    sessionSecrets.set(ownerId, {
      ...sessionSecrets.get(ownerId),
      [provider]: { ...current, validated, updatedAt: new Date().toISOString() }
    });
  }
}

export const secretStore: SecretStore = new InMemorySecretStore();