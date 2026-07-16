export function safeCallbackUrl(value: string | null | undefined, fallback = "/dashboard") {
  if (!value) return fallback;

  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }

  return candidate;
}
