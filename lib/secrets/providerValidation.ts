import type { ConfigurableProvider } from "@/lib/secrets/types";

export type ProviderValidationCode =
  | "VALID"
  | "INVALID_CREDENTIALS"
  | "ACCESS_DENIED"
  | "QUOTA_RESTRICTED"
  | "ENDPOINT_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "NETWORK_UNREACHABLE";

export type ProviderValidationResult = {
  valid: boolean;
  usable: boolean;
  conclusive: boolean;
  code: ProviderValidationCode;
  message: string;
  httpStatus?: number;
};

function providerName(provider: ConfigurableProvider) {
  return provider === "deepseek" ? "DeepSeek" : "百炼 Qwen-Image";
}

function successMessage(provider: ConfigurableProvider) {
  return provider === "deepseek"
    ? "DeepSeek 连接验证成功，未发起文本生成。"
    : "百炼密钥验证成功，未发起图片生成。";
}

async function readProviderCode(response: Response) {
  try {
    const payload = await response.json() as {
      code?: unknown;
      error?: { code?: unknown };
    };
    const code = payload.code ?? payload.error?.code;
    return typeof code === "string" ? code.slice(0, 96) : "";
  } catch {
    return "";
  }
}

function isQuotaCode(code: string) {
  return /(quota|rate.?limit|throttl|insufficient.?balance|free.?tier)/i.test(code);
}

export async function validateProviderConnection({
  provider,
  apiKey,
  baseUrl,
  timeoutMs = 15_000
}: {
  provider: ConfigurableProvider;
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
}): Promise<ProviderValidationResult> {
  const name = providerName(provider);
  const path = provider === "deepseek" ? "/models" : "/api/v1/models";

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (response.ok) {
      return {
        valid: true,
        usable: true,
        conclusive: true,
        code: "VALID",
        message: successMessage(provider),
        httpStatus: response.status
      };
    }

    const providerCode = await readProviderCode(response);
    if (response.status === 401 || /invalid.?api.?key|authentication/i.test(providerCode)) {
      return {
        valid: false,
        usable: false,
        conclusive: true,
        code: "INVALID_CREDENTIALS",
        message: `${name} 拒绝了当前密钥（HTTP ${response.status}）。请确认密钥完整、未复制多余空格，并且属于对应平台。`,
        httpStatus: response.status
      };
    }

    if (response.status === 402 || response.status === 429 || isQuotaCode(providerCode)) {
      return {
        valid: true,
        usable: false,
        conclusive: true,
        code: "QUOTA_RESTRICTED",
        message: `${name} 已识别当前密钥，但账号额度或调用频率受限（HTTP ${response.status}）。请在服务商控制台检查余额、免费额度和限流状态。`,
        httpStatus: response.status
      };
    }

    if (response.status === 403) {
      return {
        valid: false,
        usable: false,
        conclusive: true,
        code: "ACCESS_DENIED",
        message: `${name} 已收到请求，但当前账号或工作空间没有访问权限（HTTP 403）。请检查模型授权与 API Key 所属地域。`,
        httpStatus: response.status
      };
    }

    if (response.status === 404 || response.status === 405) {
      return {
        valid: false,
        usable: false,
        conclusive: false,
        code: "ENDPOINT_ERROR",
        message: `${name} 验证端点不可用（HTTP ${response.status}）。请检查服务端 Base URL 与 API Key 所属地域是否一致。`,
        httpStatus: response.status
      };
    }

    if (response.status >= 500) {
      return {
        valid: false,
        usable: false,
        conclusive: false,
        code: "PROVIDER_UNAVAILABLE",
        message: `${name} 服务暂时不可用（HTTP ${response.status}），密钥状态未被改动，请稍后重试。`,
        httpStatus: response.status
      };
    }

    return {
      valid: false,
      usable: false,
      conclusive: false,
      code: "ENDPOINT_ERROR",
      message: `${name} 返回了无法确认密钥状态的响应（HTTP ${response.status}）。请检查服务端地址与模型服务状态。`,
      httpStatus: response.status
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "";
    if (errorName === "TimeoutError" || errorName === "AbortError") {
      return {
        valid: false,
        usable: false,
        conclusive: false,
        code: "TIMEOUT",
        message: `${name} 连接超时，密钥状态未被改动。请检查当前服务器能否访问模型服务后重试。`
      };
    }

    return {
      valid: false,
      usable: false,
      conclusive: false,
      code: "NETWORK_UNREACHABLE",
      message: `${name} 无法从当前服务器访问。密钥已经保存，但尚未完成真实验证；请检查服务器网络、代理或防火墙。`
    };
  }
}
