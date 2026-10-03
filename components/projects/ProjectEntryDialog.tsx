"use client";

import { useEffect, useState } from "react";
import { ViewportDrawer } from "@/components/workspace/ViewportDrawer";
import { createProjectFromBrowser } from "@/lib/projects/createProjectClient";

export type ProjectSummary = { projectId: string; name: string; updatedAt: number; stage: string };

export function ProjectEntryDialog({ open, onClose, onEnter, onManage, notice }: {
  open: boolean;
  onClose: () => void;
  onEnter: (projectId: string) => void;
  onManage?: () => void;
  notice?: string;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function create() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      onEnter(await createProjectFromBrowser());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "新建项目失败，请稍后重试。");
      setCreating(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setSelectedId(null);
    void fetch("/api/projects?summary=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("项目列表暂时无法读取，请重试。");
        return response.json() as Promise<{ data?: { projects?: ProjectSummary[] } }>;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setProjects([...(result.data?.projects ?? [])].sort((a, b) => b.updatedAt - a.updatedAt));
        setError(null);
      })
      .catch(() => { if (!controller.signal.aborted) setError("项目列表暂时无法读取，请重试。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);

  return <ViewportDrawer open={open} label="进入工作台" onClose={onClose} className="project-entry-dialog">
    <header className="project-entry-dialog__header">
      <div><h2>进入工作台</h2><p>选择一个已有项目，或创建新项目。</p></div>
      <button type="button" aria-label="关闭项目选择" onClick={onClose}>×</button>
    </header>
    {notice ? <p className="project-entry-dialog__notice" role="status">{notice}</p> : null}
    <div className="project-entry-dialog__list" role="group" aria-label="已有项目">
      {loading ? <p className="project-entry-dialog__empty">正在读取项目…</p>
        : error ? <p className="project-entry-dialog__empty" role="alert">{error}</p>
          : projects.length ? projects.map((project) => <button type="button" key={project.projectId}
            className={`project-entry-dialog__item${selectedId === project.projectId ? " is-selected" : ""}`}
            aria-pressed={selectedId === project.projectId} onClick={() => setSelectedId(project.projectId)}>
            <strong>{project.name || "未命名项目"}</strong>
            <span>{project.stage} · {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </button>) : <p className="project-entry-dialog__empty">还没有项目</p>}
    </div>
    <footer className="project-entry-dialog__actions">
      {onManage ? <button type="button" className="project-entry-dialog__manage" onClick={onManage}>管理项目</button> : null}
      <button type="button" className="button-secondary-v3" disabled={creating || loading || projects.length >= 3} onClick={() => void create()}>{creating ? "正在创建…" : projects.length ? "新建项目" : "新建第一个项目"}</button>
      {projects.length ? <button type="button" className="button-primary-v3" disabled={!selectedId} onClick={() => selectedId && onEnter(selectedId)}>进入项目</button> : null}
    </footer>
  </ViewportDrawer>;
}
