export type ClientApiResponse<T> = {
  success: boolean;
  data: T | null;
  trace?: unknown;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  error?: string | null;
};

export async function readClientApiResponse<T>(response: Response): Promise<ClientApiResponse<T>> {
  const raw = await response.text();
  const parsed = parseJson(raw) as Partial<ClientApiResponse<T>> | null;

  if (parsed && typeof parsed === "object") {
    return {
      success: response.ok && parsed.success !== false,
      data: parsed.data ?? null,
      trace: parsed.trace,
      fallbackUsed: parsed.fallbackUsed,
      fallbackReason: parsed.fallbackReason,
      error: parsed.error ?? (response.ok ? null : transportError(response.status, raw))
    };
  }

  return {
    success: false,
    data: null,
    fallbackUsed: false,
    fallbackReason: null,
    error: transportError(response.status, raw)
  };
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function transportError(status: number, raw: string) {
  if (/upstream error|application failed to respond|bad gateway|gateway timeout/i.test(raw)) {
    return "生成服务连接暂时中断，任务不一定失败。系统会继续查询任务状态，请稍后重试。";
  }
  if (status === 502 || status === 503 || status === 504) {
    return "生成服务暂时不可用，请稍后重试。";
  }
  return `服务返回了无法识别的响应（HTTP ${status}），请稍后重试。`;
}
