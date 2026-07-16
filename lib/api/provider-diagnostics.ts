export type ProviderDiagnosticCode =
  | "json_parse_failed"
  | "schema_validation_failed"
  | "missing_api_key"
  | "image_disabled"
  | "model_not_supported"
  | "size_invalid"
  | "permission_denied"
  | "no_image_url"
  | "task_timeout"
  | "provider_call_failed"
  | "unknown";

export type ProviderDiagnostic = {
  code: ProviderDiagnosticCode;
  title: string;
  detail: string;
  hint: string;
};

function normalizeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return { message, normalized: message.toLowerCase() };
}

export function diagnoseProviderFallback(error: unknown): ProviderDiagnostic {
  const { message, normalized } = normalizeMessage(error);

  if (normalized.includes("尚未配置") || normalized.includes("api_key") || normalized.includes("deepseek_api_key")) {
    return {
      code: "missing_api_key",
      title: "密钥未配置",
      detail: "服务端没有拿到 DeepSeek 密钥，已切换到模板分镜。",
      hint: "请在模型设置里保存并校验 DeepSeek Key。"
    };
  }

  if (normalized.includes("json") || normalized.includes("parse")) {
    return {
      code: "json_parse_failed",
      title: "JSON 格式异常",
      detail: "DeepSeek 返回内容不是可解析的结构化 JSON，已切换到模板分镜。",
      hint: "可重新生成一次，或降低自由文案后再试。"
    };
  }

  if (
    normalized.includes("validation") ||
    normalized.includes("zod") ||
    normalized.includes("required") ||
    normalized.includes("expected") ||
    normalized.includes("subtitle") ||
    normalized.includes("duration") ||
    normalized.includes("recommendedmodel") ||
    normalized.includes("storyboard total")
  ) {
    return {
      code: "schema_validation_failed",
      title: "结构校验未通过",
      detail: "DeepSeek 已返回内容，但字段、字幕长度、时长或模型名不符合分镜 Schema。",
      hint: "建议重试，系统会继续使用模板分镜兜底。"
    };
  }

  if (message) {
    return {
      code: "provider_call_failed",
      title: "模型调用失败",
      detail: "DeepSeek 请求未成功完成，已切换到模板分镜。",
      hint: "请检查密钥、额度、网络或服务状态。"
    };
  }

  return {
    code: "unknown",
    title: "原因未识别",
    detail: "系统检测到真实调用未完成，已切换到模板分镜。",
    hint: "可查看服务端日志或重新执行所选调用。"
  };
}

export function diagnoseQwenImageFallback(error: unknown): ProviderDiagnostic {
  const { message, normalized } = normalizeMessage(error);

  if (normalized.includes("enable_real_image")) {
    return {
      code: "image_disabled",
      title: "真实生图未开启",
      detail: "服务端当前未启用 Qwen-Image 真实生图，因此使用本地占位图兜底。",
      hint: "请确认 AI_MODE=real 且 ENABLE_REAL_IMAGE=true，或在页面使用模板模式。"
    };
  }

  if (normalized.includes("dashscope_api_key") || normalized.includes("api_key") || normalized.includes("key")) {
    return {
      code: "missing_api_key",
      title: "百炼 Key 未配置",
      detail: "服务端没有解析到 Qwen-Image 可用密钥，因此没有向百炼发出生图请求。",
      hint: "请在模型设置里保存并校验 Qwen-Image Key。页面配置的 Key 可以生效，不需要暴露到前端。"
    };
  }

  if (
    normalized.includes("accessdenied") ||
    normalized.includes("access denied") ||
    normalized.includes("permission") ||
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("does not support")
  ) {
    return {
      code: "permission_denied",
      title: "账号权限不支持",
      detail: "百炼已拒绝当前请求，常见原因是账号未开通该模型、地域或调用方式不匹配。",
      hint: "请在百炼控制台确认该 Key 是否已开通 Qwen-Image，并检查同步/异步接口权限。"
    };
  }

  if (
    normalized.includes("model") &&
    (normalized.includes("invalid") || normalized.includes("not found") || normalized.includes("unsupported") || normalized.includes("not support"))
  ) {
    return {
      code: "model_not_supported",
      title: "模型名称不被支持",
      detail: "百炼不接受当前 model 参数。Key 配置成功不代表这个模型 ID 一定可用。",
      hint: "请在模型设置或环境变量里改成百炼控制台实际支持的模型名，例如 qwen-image 或 qwen-image-2.0。"
    };
  }

  if (
    normalized.includes("size") ||
    normalized.includes("1536*2688") ||
    normalized.includes("2688*1536") ||
    normalized.includes("2048*2048") ||
    normalized.includes("out of range")
  ) {
    return {
      code: "size_invalid",
      title: "图片尺寸不合法",
      detail: "百炼拒绝了当前 size 参数，说明模型或账号支持的尺寸范围与项目配置不一致。",
      hint: "请将 QWEN_IMAGE_SIZE 调整为百炼支持的尺寸；9:16 常见可先尝试 1024*1792 或 1152*2048。"
    };
  }

  if (normalized.includes("task") && (normalized.includes("timeout") || normalized.includes("did not finish"))) {
    return {
      code: "task_timeout",
      title: "生图任务超时",
      detail: "百炼任务已创建，但在当前轮询窗口内没有完成并返回图片。",
      hint: "可以稍后重试单镜头生成，或降低并发，避免一次生成全部关键帧。"
    };
  }

  if (
    normalized.includes("did not include an image url") ||
    normalized.includes("did not include an image") ||
    normalized.includes("no image url") ||
    normalized.includes("task_id")
  ) {
    return {
      code: "no_image_url",
      title: "返回中没有图片链接",
      detail: "百炼请求已返回，但响应里没有可下载的图片 URL 或可轮询的 task_id。",
      hint: "这通常是接口模式或响应结构不匹配；请检查当前百炼模型是否走异步任务接口。"
    };
  }

  if (message) {
    return {
      code: "provider_call_failed",
      title: "关键帧生成失败",
      detail: "Qwen-Image 请求没有成功产出图片，系统已使用本地占位图兜底。",
      hint: "请检查模型名、Key 权限、额度、图片尺寸和百炼服务状态。"
    };
  }

  return {
    code: "unknown",
    title: "原因未识别",
    detail: "系统检测到 Qwen-Image 没有产出关键帧，已使用本地占位图兜底。",
    hint: "可重新生成单个镜头，或查看服务端日志定位百炼原始响应。"
  };
}
