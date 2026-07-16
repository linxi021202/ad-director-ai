import type React from "react";
import type { ModelRoute } from "@/lib/schemas/project";

type ModelRouteBadgeProps = { route: ModelRoute; compact?: boolean };

export function ModelRouteBadge({ route, compact = false }: ModelRouteBadgeProps) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-mist">{route.primaryModel}</div>
          <div className="mt-1 break-words text-xs text-muted">Backup: {route.backupModel}</div>
        </div>
      </div>
      {!compact && <p className="mt-3 break-words text-sm leading-6 text-muted">{route.reason}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Pill>{route.taskType}</Pill><Pill>{route.estimatedLatency}</Pill>
      </div>
      {!compact && <div className="mt-3 break-words rounded-xl border border-line bg-panel p-3 text-xs leading-5 text-muted">降级：{route.fallbackMode}</div>}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">{children}</span>;
}