export const configurableProviders = ["deepseek", "qwen-image"] as const;

export type ConfigurableProvider = (typeof configurableProviders)[number];
export type SecretProvider = ConfigurableProvider | "happyhorse";
export type SecretSource = "session" | "env" | "none";

export type SecretRecord = {
  value: string;
  lastFour: string;
  validated?: boolean;
  validatedAt?: number;
  updatedAt: number;
};

export interface SecretStore {
  get(sessionId: string, provider: ConfigurableProvider): Promise<SecretRecord | null>;
  set(sessionId: string, provider: ConfigurableProvider, value: string): Promise<SecretRecord>;
  delete(sessionId: string, provider: ConfigurableProvider): Promise<void>;
  setValidated(sessionId: string, provider: ConfigurableProvider, validated: boolean): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  clear(): Promise<void>;
}

export type ResolvedSecret = {
  value: string | null;
  source: SecretSource;
  lastFour?: string;
  code?: "PROVIDER_NOT_CONFIGURED";
  message?: string;
};

export type PublicSecretStatus = {
  configured: boolean;
  source: SecretSource;
  lastFour?: string;
  validated?: boolean;
};
