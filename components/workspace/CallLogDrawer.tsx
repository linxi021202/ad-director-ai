"use client";

import React, { useEffect, useRef, useState } from "react";
import { ViewportDrawer } from "./ViewportDrawer";

type Entry = {
  id: string; kind: "task" | "call"; taskId: string; jobId?: string; projectId: string; stage: string;
  provider: string; model?: string; mode?: string; pass?: string; shotId?: string; frameId?: string;
  status: string; startedAt: number; completedAt?: number; durationMs?: number;
  jobElapsedMs?: number; lastHeartbeatAt?: number; interruptedAt?: number;
  progressCurrent?: number; progressTotal?: number; attempt?: number; errorCode?: string; errorSummary?: string;
  providerErrorCode?: string; validationIssues?: Array<{ path: string; code: string; message: string }>;
  requestOptions?: { temperature?: number; maxTokens?: number; responseFormat?: string; thinking?: string };
  validationPath?: string; httpStatus?: number; providerRequestId?: string; providerTaskId?: string;
  inputTokens?: number; outputTokens?: number; outputLength?: number; finishReason?: string;
  jsonParsed?: boolean; schemaValid?: boolean; normalized?: boolean; repaired?: boolean;
  referenceImageCount?: number; outputAssetIds?: string[];
  requestHost?: string; requestPath?: string; region?: string; workspaceIdMasked?: string; apiMode?: string;
  payloadBytes?: number; submissionTimeoutMs?: number; referenceSourceTypes?: string[]; failurePhase?: string;
  networkErrorName?: string; networkErrorMessage?: string; networkCauseCode?: string; networkCauseErrno?: number; networkCauseSyscall?: string;
  message?: string;
};

const providerOptions = ["全部", "DeepSeek", "Qwen-Image", "Wan", "TTS", "Remotion"];
const statusOptions = ["全部", "运行中", "成功", "失败", "已取消", "已降级", "已跳过"];
const providerNames: Record<string, string> = { deepseek: "DeepSeek", "qwen-image": "Qwen-Image", wan: "Wan", tts: "TTS", remotion: "Remotion" };
const statusNames: Record<string, string> = { queued: "排队中", running: "运行中", "qa-review": "校验中", completed: "成功", "needs-review": "待检查", failed: "失败", fallback: "已降级", cancelled: "已取消", blocked: "已跳过", interrupted: "已中断" };

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
      if (focusShotId && focusStage) query.set("shotId", focusShotId);
      if (focusFrameId && focusStage) query.set("frameId", focusFrameId);
      if (before) query.set("before", String(before));
      const response = await fetch(`/api/call-logs?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("调用日志暂时无法读取。");
      const data = await response.json() as { data?: { entries?: Entry[] } };
      let next = data.data?.entries ?? [];
      if (!focusStage && !before && projectId && focusShotId && !next.some((entry) => entry.shotId === focusShotId)) {
        const focusedQuery = new URLSearchParams({ projectId, shotId: focusShotId, limit: "1" });
        const focusedResponse = await fetch(`/api/call-logs?${focusedQuery}`, { cache: "no-store" });
        if (focusedResponse.ok) {
          const focusedData = await focusedResponse.json() as { data?: { entries?: Entry[] } };
          next = [...next, ...(focusedData.data?.entries ?? [])];
        }
      }
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
    if (open && focusShotId && entries.length && !selectedId) setSelectedId(entries.find((entry) => entry.shotId === focusShotId && (!focusStage || entry.stage === focusStage) && (!focusFrameId || entry.frameId === focusFrameId) && entry.kind === "task")?.id
      ?? entries.find((entry) => entry.shotId === focusShotId && (!focusStage || entry.stage === focusStage) && (!focusFrameId || entry.frameId === focusFrameId))?.id ?? null);
  }, [open, focusShotId, focusFrameId, focusStage, entries, selectedId]);

  const filtered = entries.filter((entry) => (provider === "全部" || providerNames[entry.provider] === provider)
    && (status === "全部" || statusNames[entry.status] === status));
  const active = entries.filter((entry) => entry.kind === "task" && ["queued", "running", "qa-review"].includes(entry.status));
  const selected = entries.find((entry) => entry.id === selectedId);
  const currentProjectId = projectId ?? selected?.projectId ?? entries[0]?.projectId;
  const currentTaskId = selected?.taskId ?? active[0]?.taskId ?? (focusStage ? entries.find((entry) => entry.stage === focusStage && (!focusShotId || entry.shotId === focusShotId) && (!focusFrameId || entry.frameId === focusFrameId))?.taskId : entries[0]?.taskId);

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
    if (!currentProjectId || (scope === "task" && !currentTaskId)) return;
    setExporting(true);
    try {
      const query = new URLSearchParams({ projectId: currentProjectId, format });
      if (scope === "task" && currentTaskId) query.set("taskId", currentTaskId);
      const response = await fetch(`/api/call-logs/export?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("日志导出失败，请稍后重试。");
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
        <div><span>任务与模型</span><h2>调用日志</h2><p>{projectName ?? (currentProjectId ? `项目 ${currentProjectId.slice(0, 8)}` : "近期任务")}</p></div>
        <button type="button" aria-label="关闭调用日志" onClick={() => setOpen(false)}>×</button>
      </header>
      <div className="call-log-sheet__toolbar">
        <select aria-label="按模型筛选" value={provider} onChange={(event) => setProvider(event.target.value)}>{providerOptions.map((option) => <option key={option}>{option}</option>)}</select>
        <select aria-label="按状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map((option) => <option key={option}>{option}</option>)}</select>
        <details className="call-log-export"><summary>导出日志</summary><div>
          {!entries.length ? <p>当前没有可导出的调用记录。</p> : null}
          <button type="button" disabled={exporting || !currentTaskId || !entries.length} onClick={() => void exportLogs("task", "json")}>当前任务 · JSON</button>
          <button type="button" disabled={exporting || !currentTaskId || !entries.length} onClick={() => void exportLogs("task", "markdown")}>当前任务 · Markdown</button>
          <button type="button" disabled={exporting || !currentProjectId || !entries.length} onClick={() => void exportLogs("project", "json")}>当前项目 · JSON</button>
          <button type="button" disabled={exporting || !currentProjectId || !entries.length} onClick={() => void exportLogs("project", "markdown")}>当前项目 · Markdown</button>
          <button type="button" disabled={exporting || !currentTaskId || !entries.length} onClick={() => void exportLogs("task", "markdown", true)}>复制诊断摘要</button>
        </div></details>
        <button type="button" className="call-log-clear" disabled={!projectId || !entries.length || clearing} title={!entries.length ? "当前没有可清空的调用记录" : undefined} onClick={() => setConfirmClear(true)}>清空日志</button>
      </div>
      <div className="call-log-sheet__scroll">
        <section><h3>当前任务</h3>{active.length ? active.map((entry) => <button type="button" className="call-log-row" key={entry.id} onClick={() => setSelectedId(entry.id)}><span>{providerNames[entry.provider] ?? entry.provider} · {entry.stage}</span><strong>{entry.message || "任务执行中"}</strong><small>{statusNames[entry.status]} · 已运行 {Math.max(0, Math.floor((Date.now() - entry.startedAt) / 1000))} 秒{entry.progressTotal ? ` · ${entry.progressCurrent ?? 0}/${entry.progressTotal}` : ""}</small></button>) : <p className="call-log-empty">当前没有运行中的任务。</p>}</section>
        <section><h3>调用历史</h3>{filtered.map((entry) => <button type="button" className={`call-log-row${selectedId === entry.id ? " is-selected" : ""}`} key={entry.id} onClick={() => setSelectedId(entry.id)}><span>{providerNames[entry.provider] ?? entry.provider} · {entry.mode || entry.stage} {entry.shotId ? `· ${entry.shotId}` : ""}</span><strong>{entry.errorCode === "SUBMISSION_STATE_UNKNOWN" ? "提交状态待核查" : statusNames[entry.status] ?? entry.status} · {new Date(entry.startedAt).toLocaleString("zh-CN")}</strong>{entry.errorCode || entry.errorSummary ? <small>{entry.errorCode === "SUBMISSION_STATE_UNKNOWN" ? "提交状态未知" : entry.errorCode || ""} {entry.errorSummary?.slice(0, 110)}</small> : null}</button>)}
          {!filtered.length ? <p className="call-log-empty">{focusStage === "keyframes" ? "当前镜头尚无关键帧调用记录。旧任务可能未采集诊断信息，请重试该帧后查看。" : projectId && !entries.length ? "当前项目暂无调用日志。" : "暂无符合条件的记录。"}</p> : null}{hasMore ? <button type="button" className="call-log-more" disabled={loading} onClick={() => void load(entries.at(-1)?.startedAt)}>{loading ? "正在加载…" : "加载更早记录"}</button> : null}</section>
        {selected ? <section className="call-log-diagnostics"><h3>技术诊断</h3><dl>{([
          ["调用编号", selected.id], ["批次编号", selected.jobId], ["任务编号", selected.taskId], ["模型", selected.model], ["生成模式", selected.mode], ["镜头", selected.shotId], ["帧", selected.frameId], ["参考图数量", selected.referenceImageCount], ["生成素材", selected.outputAssetIds?.join("、")], ["状态", statusNames[selected.status] ?? selected.status],
          ["模型调用耗时", selected.kind === "call" && selected.durationMs !== undefined ? `${selected.durationMs} 毫秒` : undefined], ["任务跨度", selected.kind === "task" && selected.jobElapsedMs !== undefined ? `${selected.jobElapsedMs} 毫秒` : undefined], ["最后活动", selected.lastHeartbeatAt ? new Date(selected.lastHeartbeatAt).toLocaleString("zh-CN") : undefined], ["中断发现", selected.interruptedAt ? new Date(selected.interruptedAt).toLocaleString("zh-CN") : undefined],
          ["重试序号", selected.attempt], ["错误类型", selected.errorCode], ["服务商错误码", selected.providerErrorCode], ["错误详情", selected.errorSummary], ["校验路径", selected.validationPath], ["字段问题", selected.validationIssues?.map((issue) => `${issue.path}: ${issue.message}`).join("；")],
          ["HTTP 状态", selected.httpStatus], ["请求域名", selected.requestHost], ["接口路径", selected.requestPath], ["区域", selected.region], ["工作空间", selected.workspaceIdMasked], ["接口模式", selected.apiMode], ["请求体字节", selected.payloadBytes], ["提交超时", selected.submissionTimeoutMs === undefined ? undefined : `${selected.submissionTimeoutMs} 毫秒`], ["参考图来源", selected.referenceSourceTypes?.join("、")], ["失败阶段", selected.failurePhase], ["网络错误名", selected.networkErrorName], ["网络错误详情", selected.networkErrorMessage], ["底层错误码", selected.networkCauseCode], ["底层错误号", selected.networkCauseErrno], ["系统调用", selected.networkCauseSyscall],
          ["请求编号", selected.providerRequestId], ["服务商任务编号", selected.providerTaskId], ["输入 Token", selected.inputTokens], ["输出 Token", selected.outputTokens], ["输出长度", selected.outputLength], ["结束原因", selected.finishReason], ["JSON 解析", selected.jsonParsed === undefined ? undefined : selected.jsonParsed ? "成功" : "失败"], ["结构校验", selected.schemaValid === undefined ? undefined : selected.schemaValid ? "通过" : "失败"], ["修复", selected.repaired === undefined ? undefined : selected.repaired ? "已执行" : "未执行"], ["请求参数", selected.requestOptions ? JSON.stringify(selected.requestOptions) : undefined]
        ] as Array<[string, string | number | undefined]>).filter(([, value]) => value !== undefined).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></section> : null}
        {error ? <p className="call-log-error">{error}</p> : null}
        {notice ? <p className="call-log-notice" role="status">{notice}</p> : null}
      </div>
      {confirmClear ? <div className="call-log-confirm-layer"><div role="alertdialog" aria-modal="true" aria-label="确认清空调用日志"><strong>清空当前项目日志？</strong><p>清空后将无法恢复，但不会删除项目内容和生成素材。</p><div><button type="button" disabled={clearing} onClick={() => setConfirmClear(false)}>取消</button><button type="button" className="is-danger" disabled={clearing} onClick={() => void clearLogs()}>{clearing ? "清空中…" : "确认清空"}</button></div></div></div> : null}
    </ViewportDrawer>
  </>;
}
