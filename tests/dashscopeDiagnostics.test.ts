import { describe, expect, it } from "vitest";
import { classifySubmissionFailure, describeDashScopeEndpoint } from "../lib/image/dashscopeDiagnostics";

describe("DashScope transport diagnostics", () => {
  it("keeps only the host and fixed path, without URL credentials or query strings", () => {
    const result = describeDashScopeEndpoint("https://dashscope-intl.aliyuncs.com?secret=never-log", "/api/v1/models");
    expect(result).toMatchObject({ requestHost: "dashscope-intl.aliyuncs.com", requestPath: "/api/v1/models", region: "ap-southeast-1" });
    expect(JSON.stringify(result)).not.toContain("never-log");
  });

  it("classifies DNS and redacts URLs in nested errors", () => {
    const error = Object.assign(new TypeError("fetch https://private.example/image?token=secret failed"), {
      cause: Object.assign(new Error("not found"), { code: "ENOTFOUND", syscall: "getaddrinfo" })
    });
    expect(classifySubmissionFailure(error, "WAITING_RESPONSE")).toMatchObject({ failurePhase: "DNS", causeCode: "ENOTFOUND" });
    expect(JSON.stringify(classifySubmissionFailure(error, "WAITING_RESPONSE"))).not.toContain("private.example");
  });
});
