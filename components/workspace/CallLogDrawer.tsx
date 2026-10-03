"use client";

import React, { useEffect, useRef, useState } from "react";
import { ViewportDrawer } from "./ViewportDrawer";
import { resolveScopedTask } from "@/lib/logs/taskAssociation";

type Entry = {
  id: string; requestId?: string; kind: "task" | "call"; taskId: string; jobId?: string; projectId: string; stage: string;
  provider: string; model?: string; mode?: string; pass?: string; shotId?: string; frameId?: string;
  anchorType?: "character" | "scene"; candidateId?: string; candidateIndex?: number;
  status: string; startedAt: number; completedAt?: number; durationMs?: number;
  jobElapsedMs?: number; lastHeartbeatAt?: number; interruptedAt?: number;
  progressCurrent?: number; progressTotal?: number; attempt?: number; errorCode?: string; blockedBy?: string; errorSummary?: string;
  retryReason?: "user_retry"; previousAttempt?: "response_timeout";
  providerErrorCode?: string; validationIssues?: Array<{ path: string; code: string; message: string }>;
  requestOptions?: { temperature?: number; maxTokens?: number; responseFormat?: string; thinking?: string };
  validationPath?: string; httpStatus?: number; providerRequestId?: string; providerTaskId?: string;
  inputTokens?: number; outputTokens?: number; outputLength?: number; finishReason?: string;
  jsonParsed?: boolean; schemaValid?: boolean; normalized?: boolean; repaired?: boolean;
  promptStage?: "foundation" | "frame" | "qa" | "repair";
  resultVersion?: "raw" | "normalized" | "repaired" | "final";
  qualityIssues?: Array<{ path: string; code: string; reason: string; suggestion: string }>;
  canonicalValid?: boolean; finalUsed?: boolean;
  referenceImageCount?: number; outputAssetIds?: string[];
  requestHost?: string; requestPath?: string; region?: string; workspaceIdMasked?: string; apiMode?: string;
  payloadBytes?: number; submissionTimeoutMs?: number; referenceSourceTypes?: string[]; failurePhase?: string;
  providerResponseTimeoutMs?: number; timeoutSource?: string; providerOutcome?: string; referenceAssetIds?: string[];
  referenceMetadataSummary?: Array<{ assetId?: string; source: string; width?: number; height?: number; bytes?: number; mimeType?: string }>;
  responseReceivedAt?: number; assetPersistedAt?: number; projectPatchedAt?: number;
  projectPatchStartedAt?: number; projectPatchCompletedAt?: number; projectVersionAfter?: number; keyframeRecordId?: string;
  networkErrorName?: string; networkErrorMessage?: string; networkCauseCode?: string; networkCauseErrno?: number; networkCauseSyscall?: string;
  errorName?: string; causeCode?: string; requestStartedAt?: number; requestCompletedAt?: number;
  errorStack?: string; projectVersionBefore?: number; projectVersionExpected?: number; projectVersionActual?: number;
  projectVersionAtStart?: number; projectVersionBeforePersist?: number; projectVersionAfterPersist?: number;
  persistAttempt?: number; persistStatus?: string; anchorTargetId?: string;
  message?: string;
};

const providerOptions = ["全部", "DeepSeek", "Qwen-Image", "Wan", "TTS", "Remotion"];
const statusOptions = ["全部", "运行中", "成功", "失败", "已取消", "已降级", "已跳过"];
const providerNames: Record<string, string> = { system: "系统处理", deepseek: "DeepSeek", "qwen-image": "Qwen-Image", wan: "Wan", tts: "TTS", remotion: "Remotion" };
const commitModeNames: Record<string, string> = { "prompt-bundle-building": "组装最终提示词", "prompt-bundle-validated": "最终提示词校验通过",
  "prompt-bundle-persisting": "正在保存提示词", "prompt-bundle-persisted": "提示词保存成功", "shot-status-updating": "正在提交镜头状态",
  "shot-status-ready": "镜头提示词已就绪", "task-completing": "正在完成任务", "task-completed": "任务已完成",
  "prompt-commit-failed": "提示词提交失败", "prompt-pipeline-exception": "提示词处理异常", "prompt-stage-validation": "提示词结构校验",
  "scene-candidates-building": "整理场景候选", "scene-candidates-built": "场景候选已整理",
  "project-patch-started": "开始保存项目", "project-version-conflict": "项目版本冲突",
  "project-reloaded": "重新读取项目", "project-patch-retrying": "重试保存项目",
  "project-patch-completed": "项目保存完成", "project-read-after-write-verified": "保存后核验通过",
  "project-patch-failed": "项目保存失败" };
const statusNames: Record<string, string> = { queued: "排队中", running: "运行中", "qa-review": "校验中", completed: "成功", "needs-review": "待检查", failed: "失败", fallback: "已降级", cancelled: "已取消", blocked: "已跳过", interrupted: "已中断" };
const anchorLabel = (entry: Entry) => entry.anchorType && entry.candidateIndex
  ? `${entry.anchorType === "scene" ? "场景" : "人物"}候选 ${entry.candidateIndex}` : undefined;

export function CallLogDrawer({ projectId, projectName, label = "调用日志", focusShotId, focusFrameId, focusStage }: { projectId?: string; projectName?: string; label?: string; focusShotId?: string; focusFrameId?: string; focusStage?: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [provider, setProvider] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loadEpoch = useRef(0);

  async function load(before?: number) {
    const epoch = loadEpoch.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (projectId) query.set("projectId", projectId);
      if (focusStage) query.set("stage", focusStage);
      if (focusShotId) query.set("shotId", focusShotId);
      if (focusFrameId) query.set("frameId", focusFrameId);
      if (before) query.set("before", String(before));
      const response = await fetch(`/api/call-logs?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("调用日志暂时无法读取。");
      const data = await response.json() as { data?: { entries?: Entry[] } };
      const next = data.data?.entries ?? [];
      if (epoch !== loadEpoch.current) return;
      setEntries((current) => [...new Map([...current, ...next].map((entry) => [entry.id, entry])).values()]
        .sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id)));
      setHasMore((data.data?.entries ?? []).length === 50);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "调用日志暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    loadEpoch.current += 1;
    setEntries([]);
    setSelectedId(null);
    void load();
    const timer = window.setInterval(() => { void load(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [open, projectId, focusStage, focusShotId, focusFrameId]);

  useEffect(() => {
    if (open && focusShotId && entries.length && !selectedId) setSelectedId((focusStage ? resolveScopedTask(entries, focusStage, focusShotId)?.id : undefined)
      ?? entries.find((entry) => entry.shotId === focusShotId && (!focusStage || entry.stage === focusStage) && (!focusFrameId || entry.frameId === focusFrameId))?.id ?? null);
  }, [open, focusShotId, focusFrameId, focusStage, entries, selectedId]);

  const scopedEntries = entries.filter((entry) => (!focusStage || entry.stage === focusStage)
    && (!focusShotId || entry.shotId === focusShotId) && (!focusFrameId || entry.frameId === focusFrameId));
  const filtered = scopedEntries.filter((entry) => (provider === "全部" || providerNames[entry.provider] === provider)
    && (status === "全部" || statusNames[entry.status] === status));
  const active = scopedEntries.filter((entry) => entry.kind === "task" && ["queued", "running", "qa-review"].includes(entry.status));
  const selected = scopedEntries.find((entry) => entry.id === selectedId);
  const currentProjectId = projectId ?? selected?.projectId ?? entries[0]?.projectId;
  const currentTaskId = focusShotId && focusStage ? resolveScopedTask(scopedEntries, focusStage, focusShotId)?.taskId
    : selected?.taskId ?? active[0]?.taskId ?? scopedEntries.find((entry) => entry.kind === "task")?.taskId
    ?? scopedEntries[0]?.taskId;

  async function clearLogs() {
    if (!projectId) return;
    setClearing(true);
    try {
      const response = await fetch(`/api/call-logs?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const data = await response.json() as { error?: string; clearedCalls?: number; clearedEvents?: number };
      if (!response.ok) throw new Error(data.error ?? "清空调用日志失败。");
      loadEpoch.current += 1;
      setEntries([]); setSelectedId(null); setHasMore(false); setConfirmClear(false);
      setNotice("调用日志已清空。"); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "清空调用日志失败。"); }
    finally { setClearing(false); }
  }

  async function exportLogs(scope: "task" | "project", format: "json" | "markdown", copy = false) {
    if (!currentProjectId || (scope === "task" && !currentTaskId && !focusShotId)) return;
    setExporting(true);
    try {
      const query = new URLSearchParams({ projectId: currentProjectId, format });
      if (scope === "task" && currentTaskId && !focusShotId) query.set("taskId", currentTaskId);
      if (focusStage) query.set("requestedStage", focusStage);
      if (focusShotId) query.set("requestedShotId", focusShotId);
      const response = await fetch(`/api/call-logs/export?${query}`, { cache: "no-store" });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(failure?.error ?? "日志导出失败，请稍后重试。");
      }
      const content = await response.text();
      if (copy) await navigator.clipboard.writeText(content.replace(/^\uFEFF/, ""));
      else {
        const filename = `AdDirectorAI_${format === "json" ? "调用日志" : "调用诊断"}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${format === "json" ? "json" : "md"}`;
        const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = filename; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "日志导出失败，请稍后重试。"); }
    finally { setExporting(false); }
  }

  return <>
    <button type="button" className="call-log-trigger" onClick={() => setOpen(true)}>{label}</button>
    <ViewportDrawer open={open} label="调用日志" onClose={() => setOpen(false)} className="call-log-sheet">
      <header className="call-log-sheet__header">
        <div><span>任务与模型</span><h2>调用日志</h2><p>{focusShotId ? `镜头 ${focusShotId.replace(/^shot-0*/, "").padStart(2, "0")}${focusStage ? ` · ${focusStage === "keyframes" ? "关键帧" : focusStage === "prompts" ? "生成准备" : focusStage}` : " · 完整生成链路"}` : focusStage ? focusStage : projectName ?? (currentProjectId ? `项目 ${currentProjectId.slice(0, 8)}` : "近期任务")}</p></div>
        <button type="button" aria-label="关闭调用日志" onClick={() => setOpen(false)}>×</button>
      </header>
      <div className="call-log-sheet__toolbar">
        <select aria-label="按模型筛选" value={provider} onChange={(event) => setProvider(event.target.value)}>{providerOptions.map((option) => <option key={option}>{option}</option>)}</select>
        <select aria-label="按状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map((option) => <option key={option}>{option}</option>)}</select>
        <details className="call-log-export"><summary>导出日志</summary><div>
          {!entries.length ? <p>当前没有可导出的调用记录。</p> : null}
          {!focusShotId ? <><button type="button" disabled={exporting || !currentTaskId || !entries.length} onClick={() => void exportLogs("task", "json")}>当前任务 · JSON</button>
          <button type="button" disabled={exporting || !currentTaskId || !entries.length} onClick={() => void exportLogs("task", "markdown")}>当前任务 · Markdown</button></> : null}
          <button type="button" disabled={exporting || !currentProjectId || !entries.length} onClick={() => void exportLogs("project", "json")}>{focusShotId ? "当前镜头" : focusStage ? "当前阶段" : "当前项目"} · JSON</button>
          <button type="button" disabled={exporting || !currentProjectId || !entries.length} onClick={() => void exportLogs("project", "markdown")}>{focusShotId ? "当前镜头" : focusStage ? "当前阶段" : "当前项目"} · Markdown</button>
          <button type="button" disabled={exporting || !entries.length || !currentProjectId} onClick={() => void exportLogs(focusShotId ? "project" : "task", "markdown", true)}>复制诊断摘要</button>
        </div></details>
        <button type="button" className="call-log-clear" disabled={!projectId || !entries.length || clearing} title={!entries.length ? "当前没有可清空的调用记录" : undefined} onClick={() => setConfirmClear(true)}>清空日志</button>
      </div>
      <div className="call-log-sheet__scroll">
        <section><h3>当前任务</h3>{active.length ? active.map((entry) => <button type="button" className="call-log-row" key={entry.id} onClick={() => setSelectedId(entry.id)}><span>{providerNames[entry.provider] ?? entry.provider} · {entry.stage}</span><strong>{entry.message || "任务执行中"}</strong><small>{statusNames[entry.status]} · 已运行 {Math.max(0, Math.floor((Date.now() - entry.startedAt) / 1000))} 秒{entry.progressTotal ? ` · ${entry.progressCurrent ?? 0}/${entry.progressTotal}` : ""}</small></button>) : <p className="call-log-empty">当前没有运行中的任务。</p>}</section>
        <section><h3>调用历史</h3>{filtered.map((entry) => <button type="button" className={`call-log-row${selectedId === entry.id ? " is-selected" : ""}`} key={entry.id} onClick={() => setSelectedId(entry.id)}><span>{providerNames[entry.provider] ?? entry.provider} · {anchorLabel(entry) ?? (entry.mode ? commitModeNames[entry.mode] ?? entry.mode : entry.stage)} {entry.shotId ? `· ${entry.shotId}` : ""}</span><strong>{entry.errorCode === "SUBMISSION_STATE_UNKNOWN" ? "提交状态待核查" : statusNames[entry.status] ?? entry.status} · {new Date(entry.startedAt).toLocaleString("zh-CN")}</strong>{entry.errorCode || entry.errorSummary ? <small>{entry.errorCode === "SUBMISSION_STATE_UNKNOWN" ? "提交状态未知" : entry.errorCode || ""} {entry.errorSummary?.slice(0, 110)}</small> : null}</button>)}
          {!filtered.length ? <p className="call-log-empty">{focusStage === "prompts" && focusShotId ? `未找到镜头 ${focusShotId.replace(/^shot-0*/, "").padStart(2, "0")} 的详细提示词生成日志。` : focusStage === "keyframes" ? "当前镜头尚无关键帧调用记录。旧任务可能未采集诊断信息，请重试该帧后查看。" : projectId && !entries.length ? "当前项目暂无调用日志。" : "暂无符合条件的记录。"}</p> : null}{hasMore ? <button type="button" className="call-log-more" disabled={loading} onClick={() => void load(entries.at(-1)?.startedAt)}>{loading ? "正在加载…" : "加载更早记录"}</button> : null}</section>
        {selected ? <section className="call-log-diagnostics"><h3>技术诊断</h3><dl>{([
          ["提示词阶段", selected.promptStage ? ({ foundation: "导演基础", frame: "逐帧提示词", qa: "质量校验", repair: "局部修复" })[selected.promptStage] : undefined],
          ["结果版本", selected.resultVersion ? ({ raw: "原始输出", normalized: "规范化输出", repaired: "修复结果", final: "最终结果" })[selected.resultVersion] : undefined],
          ["规范结构", selected.canonicalValid === undefined ? undefined : selected.canonicalValid ? "有效" : "无效"],
          ["最终采用", selected.finalUsed === undefined ? undefined : selected.finalUsed ? "是" : "否"],
          ["质量问题", selected.qualityIssues?.map((issue) => `${issue.path}：${issue.reason}；建议：${issue.suggestion}`).join("\n")],
          ["调用编号", selected.id], ["请求关联编号", selected.requestId], ["批次编号", selected.jobId], ["任务编号", selected.taskId], ["候选", anchorLabel(selected)], ["候选编号", selected.candidateId], ["模型", selected.model], ["生成模式", selected.mode ? commitModeNames[selected.mode] ?? selected.mode : undefined], ["镜头", selected.shotId], ["帧", selected.frameId], ["参考图数量", selected.referenceImageCount], ["生成素材", selected.outputAssetIds?.join("、")], ["状态", statusNames[selected.status] ?? selected.status],
          ["生成前项目版本", selected.projectVersionAtStart], ["持久化前项目版本", selected.projectVersionBeforePersist],
          ["持久化后项目版本", selected.projectVersionAfterPersist], ["保存尝试次数", selected.persistAttempt],
          ["持久化状态", selected.persistStatus], ["场景需求编号", selected.anchorTargetId],
          ["保存前项目版本", selected.projectVersionBefore], ["预期项目版本", selected.projectVersionExpected], ["实际项目版本", selected.projectVersionActual], ["内部异常堆栈", selected.errorStack],
          ["模型调用耗时", selected.kind === "call" && selected.durationMs !== undefined ? `${selected.durationMs} 毫秒` : undefined], ["任务跨度", selected.kind === "task" && selected.jobElapsedMs !== undefined ? `${selected.jobElapsedMs} 毫秒` : undefined], ["最后活动", selected.lastHeartbeatAt ? new Date(selected.lastHeartbeatAt).toLocaleString("zh-CN") : undefined], ["中断发现", selected.interruptedAt ? new Date(selected.interruptedAt).toLocaleString("zh-CN") : undefined],
          ["重试序号", selected.attempt], ["重试原因", selected.retryReason === "user_retry" ? "用户明确重试" : undefined], ["前次结果", selected.previousAttempt === "response_timeout" ? "模型响应超时" : undefined], ["错误类型", selected.errorCode], ["受阻原因", selected.blockedBy], ["异常类型", selected.errorName], ["底层异常码", selected.causeCode], ["请求开始", selected.requestStartedAt ? new Date(selected.requestStartedAt).toLocaleString("zh-CN") : undefined], ["请求完成", selected.requestCompletedAt ? new Date(selected.requestCompletedAt).toLocaleString("zh-CN") : undefined], ["服务商错误码", selected.providerErrorCode], ["错误详情", selected.errorSummary], ["校验路径", selected.validationPath], ["字段问题", selected.validationIssues?.map((issue) => `${issue.path}: ${issue.message}`).join("；")],
          ["HTTP 状态", selected.httpStatus], ["请求域名", selected.requestHost], ["接口路径", selected.requestPath], ["区域", selected.region], ["工作空间", selected.workspaceIdMasked], ["接口模式", selected.apiMode], ["请求体字节", selected.payloadBytes], ["请求等待上限", (selected.providerResponseTimeoutMs ?? selected.submissionTimeoutMs) === undefined ? undefined : `${selected.providerResponseTimeoutMs ?? selected.submissionTimeoutMs} 毫秒`], ["超时来源", selected.timeoutSource], ["服务商结果", selected.providerOutcome === "unknown" ? "未知" : selected.providerOutcome === "succeeded" ? "成功" : selected.providerOutcome === "failed" ? "失败" : undefined], ["参考图资产", selected.referenceAssetIds?.join("、")], ["参考图信息", selected.referenceMetadataSummary?.map((item) => `${item.source} ${item.assetId ?? ""} ${item.width ?? "?"}×${item.height ?? "?"} ${item.bytes ?? "?"} 字节 ${item.mimeType ?? ""}`).join("；")], ["参考图来源", selected.referenceSourceTypes?.join("、")], ["响应时间", selected.responseReceivedAt ? new Date(selected.responseReceivedAt).toLocaleString("zh-CN") : undefined], ["素材保存时间", selected.assetPersistedAt ? new Date(selected.assetPersistedAt).toLocaleString("zh-CN") : undefined], ["项目写入开始", selected.projectPatchStartedAt ? new Date(selected.projectPatchStartedAt).toLocaleString("zh-CN") : undefined], ["项目写入完成", selected.projectPatchCompletedAt ? new Date(selected.projectPatchCompletedAt).toLocaleString("zh-CN") : undefined], ["写入前版本", selected.projectVersionBefore], ["写入后版本", selected.projectVersionAfter], ["关键帧记录", selected.keyframeRecordId], ["失败阶段", selected.failurePhase], ["网络错误名", selected.networkErrorName], ["网络错误详情", selected.networkErrorMessage], ["底层错误码", selected.networkCauseCode], ["底层错误号", selected.networkCauseErrno], ["系统调用", selected.networkCauseSyscall],
          ["请求编号", selected.providerRequestId], ["服务商任务编号", selected.providerTaskId], ["输入 Token", selected.inputTokens], ["输出 Token", selected.outputTokens], ["输出长度", selected.outputLength], ["结束原因", selected.finishReason], ["JSON 解析", selected.jsonParsed === undefined ? undefined : selected.jsonParsed ? "成功" : "失败"], ["结构校验", selected.schemaValid === undefined ? undefined : selected.schemaValid ? "通过" : "失败"], ["修复", selected.repaired === undefined ? undefined : selected.repaired ? "已执行" : "未执行"], ["请求参数", selected.requestOptions ? JSON.stringify(selected.requestOptions) : undefined]
        ] as Array<[string, string | number | undefined]>).filter(([, value]) => value !== undefined).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></section> : null}
        {error ? <p className="call-log-error">{error}</p> : null}
        {notice ? <p className="call-log-notice" role="status">{notice}</p> : null}
      </div>
      {confirmClear ? <div className="call-log-confirm-layer"><div role="alertdialog" aria-modal="true" aria-label="确认清空调用日志"><strong>清空当前项目日志？</strong><p>清空后将无法恢复，但不会删除项目内容和生成素材。</p><div><button type="button" disabled={clearing} onClick={() => setConfirmClear(false)}>取消</button><button type="button" className="is-danger" disabled={clearing} onClick={() => void clearLogs()}>{clearing ? "清空中…" : "确认清空"}</button></div></div></div> : null}
    </ViewportDrawer>
  </>;
}
