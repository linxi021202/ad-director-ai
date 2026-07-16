import React from "react";
import Link from "next/link";
import type { ReactNode } from "react";

import { UserMenu } from "../auth/UserMenu";

type WorkspaceHeaderProps = {
  active: "工作台" | "项目" | "设置";
  projectHref: string;
  trailing?: ReactNode;
};

export function WorkspaceHeader({ active, projectHref, trailing }: WorkspaceHeaderProps) {
  const navItems = [
    { label: "工作台", href: "/generate" },
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
          <Link key={item.label} className={active === item.label ? "is-active" : ""} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="workspace-header__tools">
        {trailing}
        <button type="button" aria-label="查看通知"><span className="workspace-tool-dot" /></button>
        <UserMenu />
      </div>
    </header>
  );
}