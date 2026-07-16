import type { LLMMessage } from "./types";

export function ensureJsonPromptHint(messages: LLMMessage[]): LLMMessage[] {
  const hasJsonHint = messages.some((message) => message.content.toLowerCase().includes("json"));

  if (hasJsonHint) {
    return messages;
  }

  return [
    {
      role: "system",
      content: "Return valid JSON only. Do not wrap the JSON in markdown."
    },
    ...messages
  ];
}

export function stripMarkdownCodeFence(content: string): string {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch?.[1]?.trim() ?? trimmed;
}

export function parseJsonResponse(content: string): { success: true; json: unknown } | { success: false; error: string } {
  try {
    return { success: true, json: JSON.parse(content) };
  } catch {
    const cleaned = stripMarkdownCodeFence(content);

    try {
      return { success: true, json: JSON.parse(cleaned) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to parse JSON response."
      };
    }
  }
}
