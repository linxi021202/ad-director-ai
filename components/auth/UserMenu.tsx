"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export function UserMenu() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await authClient.signOut();
    router.replace("/");
    router.refresh();
  }

  const label = session?.user.name?.trim() || session?.user.email || "账号";

  return (
    <div className="workspace-user-menu">
      <button type="button" className="workspace-avatar" aria-label="打开用户菜单" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {label.slice(0, 1).toUpperCase()}
      </button>
      {open ? (
        <div className="workspace-user-menu__panel">
          <strong>{label}</strong>
          <span>{session?.user.email}</span>
          <Link href="/dashboard" onClick={() => setOpen(false)}>项目概览</Link>
          <Link href="/settings" onClick={() => setOpen(false)}>设置</Link>
          <button type="button" onClick={signOut}>退出登录</button>
        </div>
      ) : null}
    </div>
  );
}
