"use client";

import React, { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ViewportDrawer({ open, label, onClose, children, className = "" }: {
  open: boolean; label: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      if (document.activeElement === panelRef.current) { event.preventDefault(); (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus(); return; }
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = oldOverflow;
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="viewport-drawer-backdrop" onMouseDown={onClose}>
      <section ref={panelRef} tabIndex={-1} className={`viewport-drawer-panel ${className}`} role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </section>
    </div>,
    document.body
  );
}
