import Link from "next/link";

import { DeleteAnonymousProjectButton } from "@/components/DeleteAnonymousProjectButton";
import { MAX_ANONYMOUS_PROJECTS, listAnonymousProjects } from "@/lib/projects/anonymousProjectStore";
import { requireAnonymousSession } from "@/lib/session/anonymousSession";
import { getEffectiveShotCount, getProjectDurationSec } from "@/lib/video/shotConfig";

export const dynamic = "force-dynamic";

type ProjectsPageProps = {
  searchParams?: Promise<{ notice?: string }>;
};

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const session = await requireAnonymousSession();
  const projects = await listAnonymousProjects(session.id);
  const params = await searchParams;
  const atLimit = projects.length >= MAX_ANONYMOUS_PROJECTS;
  const showLimitNotice = params?.notice === "project-limit" && atLimit;

  return (
    <main className="account-page">
      <section className="account-page__content">
        <span>项目</span>
        <h1>当前临时会话的项目</h1>
        <p>项目仅在当前临时会话中保留，最多可创建 {MAX_ANONYMOUS_PROJECTS} 个。</p>
        {showLimitNotice ? (
          <div className="project-limit-notice" role="alert">
            <strong>项目数量已达上限</strong>
            <p>删除一个不再需要的项目后，即可继续创建新项目。</p>
          </div>
        ) : null}
        {!atLimit ? (
          <div className="account-actions">
            <Link href="/generate?new=1">新建项目</Link>
          </div>
        ) : null}
        {projects.length === 0 ? (
          <div className="account-actions">
            <p>当前临时会话中还没有项目。</p>
          </div>
        ) : (
          <div className="project-list">
            {projects.map((record) => (
              <article key={record.id}>
                <div>
                  <strong>{record.project.brief.productName}</strong>
                  <small>创建：{new Date(record.createdAt).toLocaleString("zh-CN")}</small>
                  <small>更新：{new Date(record.updatedAt).toLocaleString("zh-CN")}</small>
                  <small>{getEffectiveShotCount(record.project)} 个镜头 · 共 {getProjectDurationSec(record.project)} 秒</small>
                  <span>{workflowLabel(record.project)}</span>
                </div>
                <div className="account-actions">
                  <Link href={"/projects/" + record.id}>打开项目</Link>
                  <DeleteAnonymousProjectButton projectId={record.id} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function workflowLabel(project: Awaited<ReturnType<typeof listAnonymousProjects>>[number]["project"]) {
  const steps = project.workflowSteps;
  if (!steps) return project.status;
  const active = Object.entries(steps).find(([, status]) => status === "running" || status === "failed");
  return active ? active[0] + " · " + active[1] : project.status;
}