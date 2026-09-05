const secretPatterns = [
  /Bearer\s+[A-Za-z0-9._~+\/-]+/gi,
  /Authorization\s*[:=]\s*[^\s,;}]+/gi,
  /"?apiKey"?\s*[:=]\s*"?[^"]+"?/gi,
  /([?&](?:api[_-]?key|key|token)=)[^&\s]+/gi,
  /sk-[A-Za-z0-9._-]{8,}/g,
  /(DEEPSEEK_API_KEY|DASHSCOPE_API_KEY|HAPPYHORSE_API_KEY)\s*[:=]\s*[^\s,;}]+/gi
];

export type ProviderErrorKind = "deepseek" | "qwen-image" | "wan" | "happyhorse" | "generic";

const publicMessages: Record<ProviderErrorKind, string> = {
  deepseek: "DeepSeek调用失败，请检查密钥、额度或服务状态。",
  "qwen-image": "Qwen-Image调用失败，请检查密钥、工作空间或服务状态。",
  happyhorse: "HappyHorse调用失败，请检查百炼密钥、模型权限、额度或服务状态。",
  wan: "Wan 2.7 调用失败，请检查百炼密钥、模型权限、额度或服务状态。",
  generic: "模型服务调用失败，请稍后重试。"
};

export function redactProviderError(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown provider error.";
  return secretPatterns.reduce((message, pattern) => message.replace(pattern, "[redacted]"), raw).slice(0, 320);
}

export function sanitizeProviderError(_error: unknown, provider: ProviderErrorKind = "generic") {
  return publicMessages[provider];
}
