import Link from "next/link";
import React, { type ReactNode } from "react";
import { CallLogDrawer } from "./CallLogDrawer";

type WorkspaceHeaderProps = {
  active: "工作台" | "项目" | "设置";
  projectHref: string;
  workbenchHref?: string;
  projectName?: string;
  trailing?: ReactNode;
};

export function WorkspaceHeader({ active, projectHref, workbenchHref = "/generate", projectName, trailing }: WorkspaceHeaderProps) {
  const navItems = [
    { label: "首页", href: "/" },
    { label: "工作台", href: workbenchHref },
    { label: "项目", href: projectHref },
    { label: "模型设置", href: "/settings" }
  ] as const;

  return (
    <header className="workspace-header">
      <Link href="/" className="workspace-brand" aria-label="AdDirector AI 首页">
        <span className="workspace-brand__mark" aria-hidden="true"><i /></span>
        <strong>AdDirector AI</strong>
      </Link>
      <nav className="workspace-nav" aria-label="工作台导航">
        {navItems.map((item) => (
          <Link
            key={item.label}
            className={active === item.label ? "is-active" : ""}
            href={item.href}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="workspace-header__tools"><CallLogDrawer projectId={new URL(workbenchHref, "http://local").searchParams.get("projectId") ?? projectHref.match(/^\/projects\/([^/?#]+)/)?.[1]} projectName={projectName} />{trailing}</div>
    </header>
  );
}
