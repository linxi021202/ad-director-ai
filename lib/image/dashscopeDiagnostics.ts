import { lookup } from "node:dns/promises";
import { connect } from "node:tls";

import type { QwenNetworkFailure } from "./types";

export function describeDashScopeEndpoint(baseUrl: string, path: string) {
  const url = new URL(baseUrl);
  const host = url.hostname;
  const region = host === "dashscope.aliyuncs.com" ? "cn-beijing"
    : host === "dashscope-intl.aliyuncs.com" ? "ap-southeast-1"
    : host === "cn-hongkong.dashscope.aliyuncs.com" ? "cn-hongkong"
    : host.match(/(?:^|\.)([a-z]{2}-[a-z]+-\d+)\.maas\.aliyuncs\.com$/)?.[1] ?? "unknown";
  return { requestHost: host, requestPath: path, region, workspaceIdMasked: "未配置" };
}

export function classifySubmissionFailure(error: unknown, phase: "WAITING_RESPONSE" | "JSON_PARSE"): QwenNetworkFailure {
  const outer = error instanceof Error ? error : undefined;
  const cause = outer && "cause" in outer && outer.cause && typeof outer.cause === "object"
    ? outer.cause as Record<string, unknown> : undefined;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  const syscall = typeof cause?.syscall === "string" ? cause.syscall : undefined;
  const failurePhase = code === "ENOTFOUND" || code === "EAI_AGAIN" ? "DNS"
    : code?.includes("CERT") || code?.startsWith("ERR_TLS") || syscall?.includes("SSL") ? "TLS"
    : code?.includes("CONNECT") || code === "ECONNREFUSED" ? "CONNECT"
    : syscall === "write" || code === "EPIPE" ? "REQUEST_WRITE" : phase;
  return {
    failurePhase,
    errorName: outer?.name?.slice(0, 80),
    errorMessage: outer?.message?.replace(/https?:\/\/\S+/gi, "[地址已隐藏]")
      .replace(/data:image\/\S+/gi, "[图片数据已隐藏]")
      .replace(/sk-[A-Za-z0-9._-]+/g, "[密钥已隐藏]").slice(0, 240),
    causeCode: code?.slice(0, 80),
    causeErrno: typeof cause?.errno === "number" ? cause.errno : undefined,
    causeSyscall: syscall?.slice(0, 80)
  };
}

export async function diagnoseDashScopeConnection(baseUrl: string, apiKey?: string) {
  const endpoint = describeDashScopeEndpoint(baseUrl, "/api/v1/models");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") return { ...endpoint, dns: "skipped", tls: "skipped", httpStatus: null, error: "仅支持 HTTPS 诊断。" };
  const host = url.hostname;
  let dns: "ok" | "failed" = "failed";
  let tls: "ok" | "failed" | "skipped" = "skipped";
  try { await lookup(host); dns = "ok"; } catch (error) {
    return { ...endpoint, dns, tls, httpStatus: null, failure: classifySubmissionFailure(error, "WAITING_RESPONSE") };
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host, port: Number(url.port) || 443, servername: host, timeout: 5_000 });
      socket.once("secureConnect", () => { socket.end(); resolve(); });
      socket.once("error", reject);
      socket.once("timeout", () => { socket.destroy(); reject(new Error("TLS connection timed out")); });
    });
    tls = "ok";
  } catch (error) {
    return { ...endpoint, dns, tls: "failed" as const, httpStatus: null, failure: classifySubmissionFailure(error, "WAITING_RESPONSE") };
  }
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/v1/models?page_no=1&page_size=1`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(8_000), cache: "no-store"
    });
    return { ...endpoint, dns, tls, httpStatus: response.status };
  } catch (error) {
    return { ...endpoint, dns, tls, httpStatus: null, failure: classifySubmissionFailure(error, "WAITING_RESPONSE") };
  }
}
