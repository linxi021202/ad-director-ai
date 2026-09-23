"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Entry = {
  id: string; kind: "task" | "call"; taskId: string; projectId: string; stage: string;
  provider: string; model?: string; mode?: string; pass?: string; shotId?: string; frameId?: string;
  status: string; startedAt: number; completedAt?: number; durationMs?: number;
  progressCurrent?: number; progressTotal?: number; attempt?: number; errorCode?: string; errorSummary?: string;
  validationPath?: string; httpStatus?: number; providerRequestId?: string; providerTaskId?: string;
  inputTokens?: number; outputTokens?: number; outputLength?: number; finishReason?: string;
  jsonParsed?: boolean; schemaValid?: boolean; normalized?: boolean; repaired?: boolean;
  message?: string;
};

const providerOptions = ["全部", "DeepSeek", "Qwen-Image", "Wan", "TTS", "Remotion"];
const statusOptions = ["全部", "运行中", "成功", "失败", "已取消", "已降级"];
const providerNames: Record<string, string> = { deepseek: "DeepSeek", "qwen-image": "Qwen-Image", wan: "Wan", tts: "TTS", remotion: "Remotion" };
const statusNames: Record<string, string> = { queued: "排队中", running: "运行中", "qa-review": "校验中", completed: "成功", "needs-review": "待检查", failed: "失败", fallback: "已降级", cancelled: "已取消", blocked: "已阻塞", interrupted: "已中断" };

export function CallLogDrawer({ projectId, label = "调用日志" }: { projectId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [provider, setProvider] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  async function load(before?: number) {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (projectId) query.set("projectId", projectId);
      if (before) query.set("before", String(before));
      const response = await fetch(`/api/call-logs?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("调用日志暂时无法读取。");
      const data = await response.json() as { data?: { entries?: Entry[] } };
      const next = data.data?.entries ?? [];
      setEntries((current) => [...new Map([...current, ...next].map((entry) => [entry.id, entry])).values()]
        .sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id)));
      setHasMore(next.length === 50);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "调用日志暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setEntries([]);
    setSelectedId(null);
    void load();
    const timer = window.setInterval(() => { void load(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const filtered = entries.filter((entry) => (provider === "全部" || providerNames[entry.provider] === provider)
    && (status === "全部" || statusNames[entry.status] === status));
  const active = entries.filter((entry) => entry.kind === "task" && ["queued", "running", "qa-review"].includes(entry.status));
  const selected = entries.find((entry) => entry.id === selectedId);

  return <>
    <button type="button" className="call-log-trigger" onClick={() => setOpen(true)}>{label}</button>
    {open && typeof document !== "undefined" ? createPortal(<div className="call-log-overlay" onMouseDown={() => setOpen(false)}>
      <aside className="call-log-drawer" role="dialog" aria-modal="true" aria-label="调用日志" onMouseDown={(event) => event.stopPropagation()}>
        <header className="call-log-drawer__header"><div><span>任务与模型</span><h2>调用日志</h2></div><button type="button" aria-label="关闭调用日志" onClick={() => setOpen(false)}>×</button></header>
        <div className="call-log-drawer__body">
          <section><h3>当前任务</h3>{active.length ? active.map((entry) => <button type="button" className="call-log-item" key={entry.id} onClick={() => setSelectedId(entry.id)}><strong>{entry.message || entry.stage}</strong><span>{providerNames[entry.provider] ?? entry.provider} · {statusNames[entry.status]} · 已运行 {Math.max(0, Math.floor((Date.now() - entry.startedAt) / 1000))} 秒</span>{entry.progressTotal ? <small>已完成 {entry.progressCurrent ?? 0} / {entry.progressTotal}</small> : null}</button>) : <p className="call-log-empty">当前没有运行中的任务。</p>}</section>
          <section><h3>调用历史</h3><div className="call-log-filters"><select aria-label="按模型筛选" value={provider} onChange={(event) => setProvider(event.target.value)}>{providerOptions.map((option) => <option key={option}>{option}</option>)}</select><select aria-label="按状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map((option) => <option key={option}>{option}</option>)}</select></div>
            {filtered.map((entry) => <button type="button" className={`call-log-item${selectedId === entry.id ? " is-selected" : ""}`} key={entry.id} onClick={() => setSelectedId(entry.id)}><strong>{entry.kind === "task" ? entry.message || entry.stage : `${providerNames[entry.provider] ?? entry.provider} · ${entry.mode || "模型调用"}`}</strong><span>{statusNames[entry.status] ?? entry.status} · {new Date(entry.startedAt).toLocaleString("zh-CN")} {entry.shotId ? `· ${entry.shotId}` : ""}</span></button>)}
            {!filtered.length ? <p className="call-log-empty">暂无符合条件的记录。</p> : null}{hasMore ? <button type="button" className="call-log-more" disabled={loading} onClick={() => void load(entries.at(-1)?.startedAt)}>{loading ? "正在加载…" : "加载更早记录"}</button> : null}</section>
          {selected ? <section className="call-log-detail"><h3>技术诊断</h3><dl>{([
            ["调用编号", selected.id], ["任务编号", selected.taskId], ["项目编号", selected.projectId], ["阶段", selected.stage], ["模型", selected.model], ["生成模式", selected.mode], ["分段", selected.pass], ["镜头", selected.shotId], ["关键帧", selected.frameId], ["状态", statusNames[selected.status] ?? selected.status], ["耗时", selected.durationMs === undefined ? undefined : `${selected.durationMs} 毫秒`], ["重试序号", selected.kind === "call" ? selected.attempt : undefined], ["错误类型", selected.errorCode], ["错误摘要", selected.errorSummary], ["校验路径", selected.validationPath], ["HTTP 状态", selected.httpStatus], ["服务商请求编号", selected.providerRequestId], ["服务商任务编号", selected.providerTaskId], ["输入 Token", selected.inputTokens], ["输出 Token", selected.outputTokens], ["输出长度", selected.outputLength], ["结束原因", selected.finishReason], ["JSON 解析", selected.jsonParsed === undefined ? undefined : selected.jsonParsed ? "成功" : "失败"], ["结构校验", selected.schemaValid === undefined ? undefined : selected.schemaValid ? "通过" : "失败"], ["字段归一化", selected.normalized === undefined ? undefined : selected.normalized ? "已执行" : "未执行"], ["结构修复", selected.repaired === undefined ? undefined : selected.repaired ? "已执行" : "未执行"]
          ] as Array<[string, string | number | undefined]>).filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section> : null}
          {error ? <p className="call-log-error">{error}</p> : null}
        </div>
      </aside>
    </div>, document.body) : null}
  </>;
}
