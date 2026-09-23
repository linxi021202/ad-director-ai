"use client";

import React, { type CSSProperties } from "react";

type Props = {
  title: string;
  description: string;
  aspectRatio: string;
  status?: "pending" | "running" | "failed";
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export function VisualAssetPlaceholder({ title, description, aspectRatio, status = "pending", actionLabel, onAction, className = "" }: Props) {
  return <div className={`visual-asset-placeholder is-${status} ${className}`} style={{ aspectRatio: aspectRatio.replace(":", " / ") } as CSSProperties} role="status">
    <div className="visual-asset-placeholder__content">
      <span className="visual-asset-placeholder__icon" aria-hidden="true"><i /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {actionLabel && onAction ? <button type="button" onClick={onAction} disabled={status === "running"}>{actionLabel}</button> : null}
    </div>
  </div>;
}
