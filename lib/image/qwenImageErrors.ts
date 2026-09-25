export type QwenFailureCode =
  | "AUTH_FAILED" | "QUOTA_EXHAUSTED" | "INSUFFICIENT_BALANCE" | "RATE_LIMITED"
  | "MODEL_NOT_AVAILABLE" | "MODEL_NOT_SUPPORTED_IN_REGION" | "INVALID_PARAMETER"
  | "INVALID_PROMPT" | "INVALID_IMAGE" | "REFERENCE_IMAGE_NOT_SUPPORTED"
  | "REQUEST_TIMEOUT" | "SUBMISSION_STATE_UNKNOWN" | "TASK_POLL_INTERRUPTED" | "TEMPORARY_PROVIDER_ERROR" | "PROVIDER_ERROR"
  | "ASSET_DOWNLOAD_FAILED" | "ASSET_PERSIST_FAILED" | "PROVIDER_NOT_CONFIGURED";

export function classifyQwenFailure(httpStatus: number | undefined, providerCode: string | undefined, message: string): QwenFailureCode {
  const detail = `${providerCode ?? ""} ${message}`.toLowerCase();
  const code = (providerCode ?? "").toLowerCase();
  if (httpStatus === 401 || httpStatus === 403 || /invalidapikey|invalid.api.key|unauthorized|authentication|permission.denied|forbidden/.test(detail)) return "AUTH_FAILED";
  if (/insufficient[._ -]*balance|arrearage|arrears|account[._ -]*balance|balance[._ -]*insufficient/.test(detail)) return "INSUFFICIENT_BALANCE";
  if (httpStatus === 402 || /quota[._ -]*exhaust|free[._ -]*quota|quota[._ -]*limit|free allocated quota exceeded/.test(detail)) return "QUOTA_EXHAUSTED";
  if (httpStatus === 429 || /rate.limit|throttl|too.many.requests/.test(detail)) return "RATE_LIMITED";
  if (/region|workspace.region/.test(detail) && /not.support|unavailable|mismatch|invalid/.test(detail)) return "MODEL_NOT_SUPPORTED_IN_REGION";
  if (/model[._ -]*not[._ -]*found|model[._ -]*not[._ -]*available|model[._ -]*unavailable|invalid[._ -]*model|model.*does.not.exist/.test(detail) || httpStatus === 404) return "MODEL_NOT_AVAILABLE";
  if (/reference.*not.support|image.input.*not.support/.test(detail)) return "REFERENCE_IMAGE_NOT_SUPPORTED";
  if (/invalid.parameter|invalidparam|malformed.request/.test(code)) return "INVALID_PARAMETER";
  if (/invalid.image|image.*invalid|image.*format|image.*too.large/.test(detail)) return "INVALID_IMAGE";
  if (/invalid.prompt|prompt.*invalid|datainspectionfailed|content.*moderation/.test(detail)) return "INVALID_PROMPT";
  if (httpStatus === 400 || /invalid.parameter|invalidparam|malformed.request|invalid.size/.test(detail)) return "INVALID_PARAMETER";
  if (/timeout|timed.out|aborterror/.test(detail)) return "REQUEST_TIMEOUT";
  if (/internalerror|serviceunavailable|temporar(?:y|ily)|server[._ -]*error|system[._ -]*error/.test(detail)) return "TEMPORARY_PROVIDER_ERROR";
  if (httpStatus !== undefined && httpStatus >= 500) return "TEMPORARY_PROVIDER_ERROR";
  return "PROVIDER_ERROR";
}

export function shouldFallbackQwen(code: QwenFailureCode): boolean {
  return ["QUOTA_EXHAUSTED", "INSUFFICIENT_BALANCE", "MODEL_NOT_AVAILABLE", "MODEL_NOT_SUPPORTED_IN_REGION", "TEMPORARY_PROVIDER_ERROR", "RATE_LIMITED"].includes(code);
}
