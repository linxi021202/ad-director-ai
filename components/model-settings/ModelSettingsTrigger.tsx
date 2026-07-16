"use client";

import type { ModelSettingsStatus } from "../ModelSettingsSheet";

export function getModelConfigurationLevel(status: ModelSettingsStatus | null) {
  if (!status) return "none" as const;
  const configured = [status.deepseek.configured, status.qwenImage.configured];
  if (configured.every(Boolean)) return "complete" as const;
  if (configured.some(Boolean)) return "partial" as const;
  return "none" as const;
}

export function ModelSettingsTrigger({ status, onClick, className = "", label = "模型设置" }: { status: ModelSettingsStatus | null; onClick: () => void; className?: string; label?: string }) {
  const level = getModelConfigurationLevel(status);
  return (
    <button type="button" aria-label={label} className={`model-settings-trigger is-${level} ${className}`.trim()} onClick={onClick}>
      <span className="model-settings-trigger__dot" aria-hidden="true" />
      <span className="model-settings-trigger__icon" aria-hidden="true"><i /></span>
      <span>{label}</span>
    </button>
  );
}
