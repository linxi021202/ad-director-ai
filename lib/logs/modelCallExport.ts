import "server-only";

import { readModelCallLogArchive } from "./modelCallStore";
import { requireOwnedAnonymousProject } from "../projects/anonymousProjectStore";

type ExportScope = { projectId: string; taskId?: string };

export async function buildModelCallExport(sessionId: string, scope: ExportScope) {
  const record = await requireOwnedAnonymousProject(sessionId, scope.projectId);
  const archive = await readModelCallLogArchive(sessionId, scope.projectId, scope.taskId);
  const entries = archive.entries.map((entry) => ({
    ...entry,
    model: entry.model ?? null,
    mode: entry.mode ?? null,
    shotId: entry.shotId ?? null,
    frameId: entry.frameId ?? null,
    completedAt: entry.completedAt ?? null,
    modelCallElapsedMs: entry.kind === "call" ? entry.durationMs ?? null : null,
    jobElapsedMs: entry.kind === "task" ? entry.jobElapsedMs ?? null : null,
    lastHeartbeatAt: entry.lastHeartbeatAt ?? null,
    interruptedAt: entry.interruptedAt ?? null,
    errorCode: entry.errorCode ?? null,
    providerErrorCode: entry.providerErrorCode ?? null,
    errorSummary: entry.errorSummary ?? null,
    httpStatus: entry.httpStatus ?? null,
    inputTokens: entry.inputTokens ?? null,
    outputTokens: entry.outputTokens ?? null,
    outputLength: entry.outputLength ?? null,
    finishReason: entry.finishReason ?? null,
    jsonParsed: entry.jsonParsed ?? null,
    schemaValid: entry.schemaValid ?? null,
    validationPath: entry.validationPath ?? null,
    validationIssues: entry.validationIssues ?? null,
    repaired: entry.repaired ?? null,
    requestOptions: entry.requestOptions ?? null,
    outputAssetIds: entry.outputAssetIds ?? null
  }));
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    scope: scope.taskId ? "task" as const : "project" as const,
    project: { id: scope.projectId, name: record.project.brief.productName },
    taskId: scope.taskId ?? null,
    environment: { nodeEnv: process.env.NODE_ENV ?? null, commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null },
    retention: { days: archive.retentionDays, maxSessionEntries: 500, limitReached: archive.retentionLimitReached, firstAvailableAt: archive.firstAvailableAt ? new Date(archive.firstAvailableAt).toISOString() : null,
      notice: archive.retentionLimitReached ? "会话日志达到保留上限，更早记录可能已被清理；本文件包含当前仍保存的全部匹配记录。" : null },
    summary: { total: entries.length, failedCalls: entries.filter((entry) => entry.kind === "call" && entry.status === "failed").length,
      interruptedTasks: entries.filter((entry) => entry.kind === "task" && entry.status === "interrupted").length,
      affectedShotIds: [...new Set(entries.filter((entry) => entry.status === "failed" && entry.shotId).map((entry) => entry.shotId!))] },
    entries,
    unavailable: ["未采集原始完整 Prompt 和模型响应正文，以保护商品与用户资料。", "既有的 TASK_INTERRUPTED 记录无法反推出实际模型调用耗时或服务器重启原因。", "服务商未返回的 HTTP 状态、Token 和请求编号以 null 表示。"]
  };
}

export function modelCallExportMarkdown(report: Awaited<ReturnType<typeof buildModelCallExport>>) {
  const lines = [
    "# AdDirector AI 调用诊断报告", "",
    "## 一、任务概览",
    `项目：${safe(report.project.name)}（${report.project.id}）`,
    `范围：${report.scope === "task" ? `任务 ${report.taskId}` : "当前项目"}`,
    `导出时间：${report.exportedAt}`, `应用提交：${report.environment.commit ?? "未提供"}`,
    `记录数量：${report.summary.total}`, "",
    "## 二、失败摘要",
    `失败模型调用：${report.summary.failedCalls}`, `中断任务：${report.summary.interruptedTasks}`,
    `受影响镜头：${report.summary.affectedShotIds.join("、") || "无已记录镜头"}`,
    ...report.entries.filter((entry) => entry.status === "failed").map((entry) => `- ${safe(entry.errorCode ?? "未知错误")}：${safe(entry.errorSummary ?? "未采集错误摘要")}；字段：${safe(entry.validationPath ?? "未采集")}`), "",
    "## 三、任务执行时间线",
    ...report.entries.map((entry) => `- ${new Date(entry.startedAt).toISOString()} | ${entry.kind === "task" ? "任务" : "模型调用"} | ${safe(entry.provider)} ${safe(entry.model ?? "")} | ${safe(entry.mode ?? entry.stage)} | ${safe(entry.shotId ?? "无镜头")} | ${safe(entry.status)} | ${entry.kind === "call" ? `模型耗时 ${entry.modelCallElapsedMs ?? "未知"} ms` : `任务跨度 ${entry.jobElapsedMs ?? "未知"} ms`}`), "",
    "## 四、逐镜头生成情况"
  ];
  const shots = [...new Set(report.entries.map((entry) => entry.shotId).filter((id): id is string => Boolean(id)))];
  for (const shotId of shots) {
    lines.push(`### ${safe(shotId)}`);
    for (const entry of report.entries.filter((item) => item.shotId === shotId)) {
      lines.push(`- ${safe(entry.mode ?? entry.stage)}：${safe(entry.status)}；${safe(entry.errorCode ?? entry.message ?? "无错误记录")}；校验路径 ${safe(entry.validationPath ?? "未采集")}`);
    }
  }
  lines.push("", "## 五、技术诊断");
  for (const entry of report.entries.filter((item) => item.kind === "call" && item.status === "failed")) {
    lines.push(`### 调用 ${entry.id}`, `任务：${entry.taskId}；镜头：${safe(entry.shotId ?? "未关联")}`, `错误代码：${safe(entry.errorCode ?? "未采集")}；服务商代码：${safe(entry.providerErrorCode ?? "未返回")}`,
      `错误详情：${safe(entry.errorSummary ?? "未采集")}`, `finish_reason：${safe(entry.finishReason ?? "未返回")}`, `JSON 解析：${entry.jsonParsed === null ? "未知" : entry.jsonParsed ? "成功" : "失败"}`, `Schema 校验：${entry.schemaValid === null ? "未知" : entry.schemaValid ? "通过" : "失败"}`,
      `字段问题：${entry.validationIssues?.map((issue) => `${safe(issue.path)} (${safe(issue.code)}: ${safe(issue.message)})`).join("；") || "未采集"}`, "");
  }
  lines.push("## 六、模型请求信息");
  for (const entry of report.entries.filter((item) => item.kind === "call")) {
    lines.push(`- ${entry.id}：${safe(entry.model ?? "未知模型")}，${safe(entry.mode ?? "未知模式")}，请求参数 ${entry.requestOptions ? JSON.stringify(entry.requestOptions) : "未采集"}，输入/输出 Token ${entry.inputTokens ?? "未知"}/${entry.outputTokens ?? "未知"}，HTTP ${entry.httpStatus ?? "未知"}，耗时 ${entry.modelCallElapsedMs ?? "未知"} ms`);
  }
  lines.push("", "## 七、完整错误详情", ...report.entries.filter((entry) => entry.errorSummary).map((entry) => `- ${entry.id}：${safe(entry.errorSummary!)}`), "", "## 八、无法获取的信息", ...report.unavailable.map((item) => `- ${item}`));
  if (report.retention.notice) lines.push("", `保留范围提示：${report.retention.notice}`);
  return `${lines.join("\n")}\n`;
}

function safe(value: string) { return value.replace(/[\r\n|]+/g, " ").replace(/`/g, "'").slice(0, 500); }
