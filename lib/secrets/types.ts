export const configurableProviders = ["deepseek", "qwen-image", "happyhorse"] as const;

export type SecretProvider = (typeof configurableProviders)[number];
export type ConfigurableProvider = SecretProvider;
export type SecretSource = "session" | "env" | "none";

export type SecretRecord = {
  value: string;
  lastFour: string;
  validated?: boolean;
  updatedAt: string;
};

export interface SecretStore {
  get(sessionId: string, provider: SecretProvider): Promise<SecretRecord | null>;
  set(sessionId: string, provider: SecretProvider, value: string): Promise<SecretRecord>;
  delete(sessionId: string, provider: SecretProvider): Promise<void>;
  setValidated(sessionId: string, provider: SecretProvider, validated: boolean): Promise<void>;
}

export type ResolvedSecret = {
  value: string | null;
  source: SecretSource;
  lastFour?: string;
};

export type PublicSecretStatus = {
  configured: boolean;
  source: SecretSource;
  lastFour?: string;
  validated?: boolean;
};
