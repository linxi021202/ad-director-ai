import "server-only";

import { readModelCallLogArchive } from "./modelCallStore";
import { resolveScopedTask } from "./taskAssociation";
import { requireOwnedAnonymousProject } from "../projects/anonymousProjectStore";

type ExportScope = { projectId: string; taskId?: string; requestedStage?: string; requestedShotId?: string };

export async function buildModelCallExport(sessionId: string, scope: ExportScope) {
  const record = await requireOwnedAnonymousProject(sessionId, scope.projectId);
  const scopedArchive = await readModelCallLogArchive(sessionId, scope.projectId, scope.taskId);
  const matches = scopedArchive.entries.filter((entry) => (!scope.requestedStage || entry.stage === scope.requestedStage)
    && (!scope.requestedShotId || entry.shotId === scope.requestedShotId));
  const selectedTask = scope.requestedStage && scope.requestedShotId
    ? resolveScopedTask(matches, scope.requestedStage, scope.requestedShotId)
    : scope.taskId ? matches.find((entry) => entry.kind === "task" && entry.taskId === scope.taskId) : undefined;
  const resolvedTaskId = scope.requestedStage && scope.requestedShotId ? selectedTask?.taskId : scope.taskId;
  const archive = resolvedTaskId && !scope.taskId
    ? await readModelCallLogArchive(sessionId, scope.projectId, resolvedTaskId) : scopedArchive;
  const entries = archive.entries.filter((entry) => (!scope.requestedStage || entry.stage === scope.requestedStage)
    && (!scope.requestedShotId || entry.shotId === scope.requestedShotId)).map((entry) => ({
    ...entry,
    requestId: entry.requestId ?? null,
    jobId: entry.jobId ?? null,
    model: entry.model ?? null,
    mode: entry.mode ?? null,
    anchorType: entry.anchorType ?? null,
    candidateId: entry.candidateId ?? null,
    candidateIndex: entry.candidateIndex ?? null,
    shotId: entry.shotId ?? null,
    frameId: entry.frameId ?? null,
    completedAt: entry.completedAt ?? null,
    modelCallElapsedMs: entry.kind === "call" ? entry.durationMs ?? null : null,
    jobElapsedMs: entry.kind === "task" ? entry.jobElapsedMs ?? null : null,
    lastHeartbeatAt: entry.lastHeartbeatAt ?? null,
    interruptedAt: entry.interruptedAt ?? null,
    errorCode: entry.errorCode ?? null,
    blockedBy: entry.blockedBy ?? null,
    routerDecision: entry.routerDecision ?? null,
    routerResult: entry.routerResult ?? null,
    selectedModel: entry.selectedModel ?? null,
    providerErrorCode: entry.providerErrorCode ?? null,
    errorSummary: entry.errorSummary ?? null,
    failurePhase: entry.failurePhase ?? null,
    errorName: entry.errorName ?? null,
    errorStack: entry.errorStack ?? null,
    causeCode: entry.causeCode ?? null,
    projectVersionBefore: entry.projectVersionBefore ?? null,
    projectVersionExpected: entry.projectVersionExpected ?? null,
    projectVersionActual: entry.projectVersionActual ?? null,
    projectPatchStartedAt: entry.projectPatchStartedAt ?? null,
    projectPatchCompletedAt: entry.projectPatchCompletedAt ?? null,
    projectVersionAfter: entry.projectVersionAfter ?? null,
    shotStatusPersisted: entry.shotStatusPersisted ?? null,
    promptBundlePersisted: entry.promptBundlePersisted ?? null,
    projectVersionAtStart: entry.projectVersionAtStart ?? null,
    projectVersionBeforePersist: entry.projectVersionBeforePersist ?? null,
    projectVersionAfterPersist: entry.projectVersionAfterPersist ?? null,
    persistAttempt: entry.persistAttempt ?? null,
    persistStatus: entry.persistStatus ?? null,
    anchorTargetId: entry.anchorTargetId ?? null,
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
    promptStage: entry.promptStage ?? null,
    resultVersion: entry.resultVersion ?? null,
    qualityIssues: entry.qualityIssues ?? null,
    canonicalValid: entry.canonicalValid ?? null,
    finalUsed: entry.finalUsed ?? null,
    requestOptions: entry.requestOptions ?? null,
    outputAssetIds: entry.outputAssetIds ?? null,
    referenceImageCount: entry.referenceImageCount ?? null,
    referenceImagesIncluded: entry.referenceImagesIncluded ?? null
  }));
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    scope: resolvedTaskId ? "task" as const : "project" as const,
    project: { id: scope.projectId, name: record.project.brief.productName },
    taskId: resolvedTaskId ?? null,
    requestedStage: scope.requestedStage ?? null,
    requestedShotId: scope.requestedShotId ?? null,
    resolvedTaskId: resolvedTaskId ?? null,
    resolvedStage: selectedTask?.stage ?? null,
    resolvedShotId: selectedTask?.shotId ?? scope.requestedShotId ?? null,
    environment: { nodeEnv: process.env.NODE_ENV ?? null, commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null },
    retention: { days: archive.retentionDays, maxSessionEntries: 500, limitReached: archive.retentionLimitReached, firstAvailableAt: archive.firstAvailableAt ? new Date(archive.firstAvailableAt).toISOString() : null,
      notice: archive.retentionLimitReached ? "会话日志达到保留上限，更早记录可能已被清理；本文件包含当前仍保存的全部匹配记录。" : null },
    summary: { total: entries.length, failedCalls: entries.filter((entry) => entry.kind === "call" && entry.provider !== "system" && entry.status === "failed").length,
      failedSystemCalls: entries.filter((entry) => entry.kind === "call" && entry.provider === "system" && entry.status === "failed").length,
      failedTasks: entries.filter((entry) => entry.kind === "task" && entry.status === "failed").length,
      interruptedTasks: entries.filter((entry) => entry.kind === "task" && entry.status === "interrupted").length,
      affectedShotIds: [...new Set(entries.filter((entry) => entry.status === "failed" && entry.shotId).map((entry) => entry.shotId!))],
      affectedCandidates: [...new Set(entries.filter((entry) => entry.status === "failed" && entry.anchorType && entry.candidateIndex)
        .map((entry) => `${entry.anchorType === "scene" ? "场景" : "人物"}候选 ${entry.candidateIndex}`))] },
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
    `请求阶段：${report.requestedStage ?? "全部"}；请求镜头：${report.requestedShotId ?? "全部"}；匹配任务：${report.resolvedTaskId ?? "无"}；匹配阶段：${report.resolvedStage ?? "无"}；匹配镜头：${report.resolvedShotId ?? "无"}`,
    `导出时间：${report.exportedAt}`, `应用提交：${report.environment.commit ?? "未提供"}`,
    `记录数量：${report.summary.total}`, "",
    "## 二、失败摘要",
    `失败模型调用：${report.summary.failedCalls}`, `失败系统处理：${report.summary.failedSystemCalls}`,
    `失败任务：${report.summary.failedTasks}`, `中断任务：${report.summary.interruptedTasks}`,
    `受影响镜头：${report.summary.affectedShotIds.join("、") || "无"}`,
    `受影响候选：${report.summary.affectedCandidates.join("、") || "无"}`,
    ...report.entries.filter((entry) => entry.status === "failed").map((entry) => `- ${safe(entry.errorCode ?? "未知错误")}：${safe(entry.errorSummary ?? "未采集错误摘要")}；字段：${safe(entry.validationPath ?? "未采集")}`), "",
    "## 三、任务执行时间线",
    ...report.entries.map((entry) => `- ${new Date(entry.startedAt).toISOString()} | ${entry.kind === "task" ? "任务" : entry.provider === "system" ? "系统处理" : "模型调用"} | ${safe(entry.provider)} ${safe(entry.model ?? "")} | ${safe(entry.mode ?? entry.stage)} | ${entry.anchorType && entry.candidateIndex ? `${entry.anchorType === "scene" ? "场景" : "人物"}候选 ${entry.candidateIndex}` : safe(entry.shotId ?? "无镜头")} | ${safe(entry.status)} | ${entry.kind === "task" ? `任务跨度 ${entry.jobElapsedMs ?? "未知"} ms` : entry.provider === "system" ? `保存状态 ${entry.persistStatus ?? "未采集"}` : `模型耗时 ${entry.modelCallElapsedMs ?? "未知"} ms`}`), "",
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
  for (const entry of report.entries.filter((item) => item.provider === "system" && item.persistStatus)) {
    lines.push(`- ${safe(entry.mode ?? "持久化")}：${safe(entry.persistStatus!)}；生成前版本 ${entry.projectVersionAtStart ?? "未采集"}；保存前版本 ${entry.projectVersionBeforePersist ?? "未采集"}；保存后版本 ${entry.projectVersionAfterPersist ?? "未采集"}；第 ${entry.persistAttempt ?? "未知"} 次尝试`);
  }
  for (const entry of report.entries.filter((item) => item.kind === "call" && item.status === "failed")) {
    lines.push(`### 调用 ${entry.id}`, `任务：${entry.taskId}；${entry.anchorType && entry.candidateIndex ? `${entry.anchorType === "scene" ? "场景" : "人物"}候选 ${entry.candidateIndex}` : `镜头：${safe(entry.shotId ?? "未关联")}`}`, `失败阶段：${safe(entry.failurePhase ?? "未采集")}；错误代码：${safe(entry.errorCode ?? "未采集")}；服务商代码：${safe(entry.providerErrorCode ?? "未返回")}`,
      `错误详情：${safe(entry.errorSummary ?? "未采集")}`, `finish_reason：${safe(entry.finishReason ?? "未返回")}`, `JSON 解析：${entry.jsonParsed === null ? "未知" : entry.jsonParsed ? "成功" : "失败"}`, `Schema 校验：${entry.schemaValid === null ? "未知" : entry.schemaValid ? "通过" : "失败"}`,
      `异常类型：${safe(entry.errorName ?? "未采集")}；底层异常码：${safe(entry.causeCode ?? "未采集")}`,
      `项目版本：开始 ${entry.projectVersionBefore ?? "未采集"}；预期 ${entry.projectVersionExpected ?? "未指定（按最新项目原子更新）"}；实际 ${entry.projectVersionActual ?? "未采集"}`,
      `异常堆栈：${safe(entry.errorStack ?? "未采集")}`,
      `字段问题：${entry.validationIssues?.map((issue) => `${safe(issue.path)} (${safe(issue.code)}: ${safe(issue.message)})`).join("；") || "未采集"}`,
      `质量证据：${entry.qualityIssues?.map((issue) => `${safe(issue.path)}：${safe(issue.reason)}；建议：${safe(issue.suggestion)}`).join("；") || "无"}`, "");
  }
  lines.push("## 六、模型请求信息");
  for (const entry of report.entries.filter((item) => item.kind === "call" && item.provider !== "system")) {
    if (entry.promptStage) lines.push(`- 提示词阶段 ${entry.promptStage}；版本 ${entry.resultVersion ?? "未采集"}；规范结构 ${entry.canonicalValid ?? "未采集"}；最终采用 ${entry.finalUsed ?? "未采集"}`);
    lines.push(`- ${entry.id}：批次 ${entry.jobId ?? "未关联"}，任务 ${entry.taskId}，镜头 ${safe(entry.shotId ?? "未知")}，帧 ${safe(entry.frameId ?? "未知")}，${safe(entry.model ?? "未知模型")}，${safe(entry.mode ?? "未知模式")}，参考图 ${entry.referenceImageCount ?? "未知"} 张，资产 ${entry.outputAssetIds?.join("、") ?? "无"}，请求参数 ${entry.requestOptions ? JSON.stringify(entry.requestOptions) : "未采集"}，输入/输出 Token ${entry.inputTokens ?? "未知"}/${entry.outputTokens ?? "未知"}，HTTP ${entry.httpStatus ?? "未知"}，耗时 ${entry.modelCallElapsedMs ?? "未知"} ms，素材保存 ${entry.assetPersistedAt ?? "未采集"}，项目写入 ${entry.projectPatchStartedAt ?? "未采集"}/${entry.projectPatchCompletedAt ?? "未采集"}，项目版本 ${entry.projectVersionBefore ?? "未采集"}→${entry.projectVersionAfter ?? "未采集"}，帧记录 ${safe(entry.keyframeRecordId ?? "未采集")}`);
  }
  lines.push("", "## 七、完整错误详情", ...report.entries.filter((entry) => entry.errorSummary).map((entry) => `- ${entry.id}：${safe(entry.errorSummary!)}`), "", "## 八、无法获取的信息", ...report.unavailable.map((item) => `- ${item}`));
  if (report.retention.notice) lines.push("", `保留范围提示：${report.retention.notice}`);
  return `${lines.join("\n")}\n`;
}

function safe(value: string) { return value.replace(/[\r\n|]+/g, " ").replace(/`/g, "'").slice(0, 500); }
