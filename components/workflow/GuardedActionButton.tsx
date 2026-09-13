"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ActionBlocker } from "@/lib/workflow/actionBlockers";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "onClick"> & {
  blockers: ActionBlocker[];
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
  onAction: () => void;
};

export function GuardedActionButton({ blockers, busy = false, busyLabel = "处理中…", children, onAction, ...buttonProps }: Props) {
  const [explaining, setExplaining] = useState(false);
  const blocked = blockers.length > 0;
  return <>
    <button {...buttonProps} type="button" disabled={busy} aria-disabled={blocked || undefined} onClick={() => blocked ? setExplaining(true) : onAction()}>{busy ? busyLabel : children}</button>
    {explaining ? <div className="guarded-action-backdrop" role="presentation" onMouseDown={() => setExplaining(false)}>
      <section className="guarded-action-sheet" role="dialog" aria-modal="true" aria-label="还不能执行这一步" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>操作说明</span><h2>还不能执行这一步</h2></div><button type="button" aria-label="关闭" onClick={() => setExplaining(false)}>×</button></header>
        <div className="guarded-action-list">{blockers.map((blocker) => <article key={`${blocker.title}-${blocker.description}`}><strong>{blocker.title}</strong><p>{blocker.description}</p>{blocker.targetAction ? <Link href={blocker.targetAction.href} onClick={() => setExplaining(false)}>{blocker.targetAction.label}</Link> : null}</article>)}</div>
      </section>
    </div> : null}
  </>;
}
