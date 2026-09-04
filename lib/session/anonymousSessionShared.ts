export const ANONYMOUS_SESSION_COOKIE = "ad_director_session";
export const ANONYMOUS_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAnonymousSessionId(value: string | null | undefined): value is string {
  if (!value || value.length > 64 || value.length < 32) return false;
  if (value.includes("/") || value.includes("\\")) return false;
  if ([...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return false;
  return UUID_PATTERN.test(value);
}
