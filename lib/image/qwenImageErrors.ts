export type QwenFailureCode =
  | "AUTH_FAILED" | "QUOTA_EXHAUSTED" | "INSUFFICIENT_BALANCE" | "RATE_LIMITED"
  | "MODEL_NOT_AVAILABLE" | "MODEL_TEMPORARILY_UNAVAILABLE" | "MODEL_NOT_SUPPORTED_IN_REGION" | "INVALID_PARAMETER"
  | "INVALID_PROMPT" | "INVALID_IMAGE" | "REFERENCE_IMAGE_NOT_SUPPORTED"
  | "REQUEST_TIMEOUT" | "SUBMISSION_STATE_UNKNOWN" | "TASK_POLL_INTERRUPTED" | "TEMPORARY_PROVIDER_ERROR" | "PROVIDER_ERROR"
  | "ASSET_DOWNLOAD_FAILED" | "ASSET_PERSIST_FAILED" | "PROVIDER_NOT_CONFIGURED" | "STORAGE_CAPACITY_LOW" | "STORAGE_UNAVAILABLE";

export function classifyQwenFailure(httpStatus: number | undefined, providerCode: string | undefined, message: string): QwenFailureCode {
  const detail = `${providerCode ?? ""} ${message}`.toLowerCase();
  const code = (providerCode ?? "").toLowerCase();
  if (httpStatus === 401 || httpStatus === 403 || /invalidapikey|invalid.api.key|unauthorized|authentication|permission.denied|forbidden/.test(detail)) return "AUTH_FAILED";
  if (/insufficient[._ -]*balance|arrearage|arrears|account[._ -]*balance|balance[._ -]*insufficient/.test(detail)) return "INSUFFICIENT_BALANCE";
  if (/allocationquota\.freetieronly|quota[._ -]*exhaust|free[._ -]*quota|quota[._ -]*limit|free allocated quota exceeded/.test(detail)) return "QUOTA_EXHAUSTED";
  if (httpStatus === 402) return "INSUFFICIENT_BALANCE";
  if (httpStatus === 429 || /rate.limit|throttl|too.many.requests/.test(detail)) return "RATE_LIMITED";
  if (/region|workspace.region/.test(detail) && /not.support|unavailable|mismatch|invalid/.test(detail)) return "MODEL_NOT_SUPPORTED_IN_REGION";
  if (/model.*temporar(?:y|ily).*unavailable|temporar(?:y|ily).*model.*unavailable/.test(detail)) return "MODEL_TEMPORARILY_UNAVAILABLE";
  if (/model[._ -]*not[._ -]*found|model[._ -]*not[._ -]*available|model[._ -]*unavailable|invalid[._ -]*model|model.*does.not.exist/.test(detail)) return "MODEL_NOT_AVAILABLE";
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
  return ["QUOTA_EXHAUSTED", "MODEL_NOT_AVAILABLE", "MODEL_TEMPORARILY_UNAVAILABLE", "MODEL_NOT_SUPPORTED_IN_REGION"].includes(code);
}

export function qwenImageUserMessage(code?: string): string {
  if (code === "STORAGE_CAPACITY_LOW") return "服务器素材存储空间不足，图片无法保存。请先扩容存储或清理不需要的素材，再重试。";
  if (code === "STORAGE_UNAVAILABLE") return "服务器素材存储暂不可用，已暂停图片生成，请稍后重试或联系管理员。";
  if (code === "QUOTA_EXHAUSTED" || code === "MODEL_NOT_AVAILABLE" || code === "MODEL_TEMPORARILY_UNAVAILABLE" || code === "MODEL_NOT_SUPPORTED_IN_REGION")
    return "当前图像模型免费额度已用尽或模型暂不可用，系统已尝试其它可用模型；请检查模型设置或更换可用模型账户。";
  if (code === "INSUFFICIENT_BALANCE" || code === "AUTH_FAILED" || code === "PROVIDER_NOT_CONFIGURED")
    return "当前百炼图像模型账户不可用，请检查 API Key 对应账户余额、权限或免费额度设置。";
  if (code === "INVALID_PARAMETER" || code === "INVALID_IMAGE" || code === "REFERENCE_IMAGE_REQUIRED" || code === "MODEL_ROUTING_FAILED")
    return "当前图片生成请求存在参数或参考图问题，请查看调用日志后重试。";
  if (code === "RATE_LIMITED") return "图像模型调用频繁，系统已排队重试；请稍后再试。";
  return "图像模型暂未生成成功，请查看调用日志后重试。";
}
