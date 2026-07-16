"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelSettingsStatus } from "../ModelSettingsSheet";

export function useModelSettingsStatus(enabled = true) {
  const [status, setStatus] = useState<ModelSettingsStatus | null>(null);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/model-settings/status", { cache: "no-store" });
      if (response.ok) setStatus((await response.json()) as ModelSettingsStatus);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, setStatus, refresh, loading };
}