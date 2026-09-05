"use client";

import { useEffect, useRef, useState } from "react";

import "./model-settings.css";

export type ProviderId = "deepseek" | "qwen-image";
type ProviderDraftKeys = {
  deepseek: string;
  qwenImage: string;
};
type SecretStatus = {
  configured: boolean;
  source: "session" | "none";
  lastFour?: string;
  validated?: boolean;
};
export type ModelSettingsStatus = {
  deepseek: SecretStatus;
  qwenImage: SecretStatus;
  wan: { capability: "api-available" | "not-configured"; apiAvailable: boolean };
  remotion: { source: "local" };
};

const providers = [
  { id: "deepseek" as const, draftKey: "deepseek" as const, statusKey: "deepseek" as const, name: "DeepSeek", role: "策略、分镜与全部提示词", label: "DeepSeek API Key" },
  { id: "qwen-image" as const, draftKey: "qwenImage" as const, statusKey: "qwenImage" as const, name: "Qwen-Image", role: "广告关键帧生成", label: "DashScope API Key" }
] as const;

function statusText(status: SecretStatus) {
  if (!status.configured) return "未配置";
  if (status.validated === true) return "验证成功 · 末四位 " + status.lastFour;
  if (status.validated === false) return "验证失败 · 末四位 " + status.lastFour;
  return "待验证 · 末四位 " + status.lastFour;
}

function readMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { message?: unknown; error?: unknown };
  if (typeof value.message === "string") return value.message;
  if (typeof value.error === "string") return value.error;
  if (value.error && typeof value.error === "object") {
    const nested = value.error as { message?: unknown };
    if (typeof nested.message === "string") return nested.message;
  }
  return fallback;
}

export function ModelSettingsSheet({
  open,
  onClose,
  status,
  onStatusChange,
  initialProvider,
  guidance
}: {
  open: boolean;
  onClose: () => void;
  status: ModelSettingsStatus | null;
  onStatusChange: (status: ModelSettingsStatus) => void;
  initialProvider?: ProviderId;
  guidance?: string | null;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const onStatusChangeRef = useRef(onStatusChange);
  const [draftKeys, setDraftKeys] = useState<ProviderDraftKeys>({ deepseek: "", qwenImage: "" });
  const [visible, setVisible] = useState<Record<ProviderId, boolean>>({ deepseek: false, "qwen-image": false });
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  async function refresh() {
    const response = await fetch("/api/model-settings/status", { cache: "no-store" });
    if (response.ok) onStatusChangeRef.current((await response.json()) as ModelSettingsStatus);
  }

  useEffect(() => {
    if (!open) {
      setDraftKeys({ deepseek: "", qwenImage: "" });
      setVisible({ deepseek: false, "qwen-image": false });
      setMessage(null);
      return;
    }

    void refresh();
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      if (initialProvider) document.getElementById("model-key-" + initialProvider)?.focus();
      else closeRef.current?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open, initialProvider]);

  async function save(provider: ProviderId) {
    const providerConfig = providers.find((item) => item.id === provider);
    if (!providerConfig) return;
    const apiKey = draftKeys[providerConfig.draftKey].trim();
    if (!apiKey) {
      setMessage("请先输入密钥。");
      return;
    }
    if (apiKey.length < 8) {
      setMessage("密钥长度不正确，请检查后重试。");
      return;
    }

    setBusy(provider);
    setMessage(null);
    try {
      const response = await fetch("/api/model-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readMessage(result, "保存失败，请检查密钥格式或稍后重试。"));
      setDraftKeys((current) => ({ ...current, [providerConfig.draftKey]: "" }));
      setMessage("密钥已保存到当前临时会话。");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请检查密钥格式或稍后重试。");
    } finally {
      setBusy(null);
    }
  }

  async function validate(provider: ProviderId) {
    setBusy(provider);
    setMessage("正在验证连接…");
    try {
      const response = await fetch("/api/model-settings/" + provider + "/validate", { method: "POST" });
      const result = await response.json().catch(() => null);
      setMessage(readMessage(result, "验证完成。"));
      await refresh();
    } catch {
      setMessage("连接测试请求失败，已保存的密钥不会被删除，请稍后重试。");
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: ProviderId) {
    const providerConfig = providers.find((item) => item.id === provider);
    if (!providerConfig) return;
    setBusy(provider);
    try {
      const response = await fetch("/api/model-settings/" + provider, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readMessage(result, "删除失败。"));
      setDraftKeys((current) => ({ ...current, [providerConfig.draftKey]: "" }));
      setMessage("当前会话密钥已删除。");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;

  return (
    <div className="model-settings-layer" role="presentation">
      <button className="model-settings-backdrop" type="button" aria-label="关闭模型设置" onClick={onClose} />
      <aside className="model-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
        <header className="model-settings-head">
          <div><h2 id="model-settings-title">模型 API 设置</h2><p>配置当前临时会话使用的文本与图片模型密钥。</p></div>
          <button ref={closeRef} className="model-settings-close" type="button" onClick={onClose} aria-label="关闭"><span /><span /></button>
        </header>

        <div className="model-security-note">
          <span className="model-shield-icon" aria-hidden="true" />
          <p>{guidance || "API Key 仅保存在当前临时会话中，不会写入项目文件。会话过期或服务重启后需要重新配置。"}</p>
        </div>

        <div className="model-provider-list">
          {providers.map((provider) => {
            const current = status?.[provider.statusKey] ?? { configured: false, source: "none" as const };
            const draft = draftKeys[provider.draftKey];
            return (
              <section className={"model-provider-card " + (initialProvider === provider.id ? "is-targeted" : "")} key={provider.id} data-provider={provider.id}>
                <div className="model-provider-title">
                  <div><h3>{provider.name}</h3><p>{provider.role}</p></div>
                  <span className={"model-status-dot " + (current.configured ? "is-configured" : "")} />
                </div>
                <label htmlFor={"model-key-" + provider.id}>{provider.label}</label>
                <div className="model-key-field">
                  <input
                    id={"model-key-" + provider.id}
                    type={visible[provider.id] ? "text" : "password"}
                    value={draft}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="text"
                    disabled={busy === provider.id}
                    placeholder={current.configured ? "输入新密钥以替换当前配置" : "输入 API Key"}
                    onChange={(event) => setDraftKeys((value) => ({ ...value, [provider.draftKey]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (draft.trim() && busy !== provider.id) void save(provider.id);
                      }
                    }}
                  />
                  <button type="button" disabled={busy === provider.id} aria-label={visible[provider.id] ? "隐藏输入" : "显示输入"} onClick={() => setVisible((value) => ({ ...value, [provider.id]: !value[provider.id] }))}>
                    <span className={"model-eye " + (visible[provider.id] ? "is-open" : "")} />
                  </button>
                </div>
                <div className="model-provider-actions">
                  <span className={"model-provider-state " + (current.validated === false && current.configured ? "is-pending" : "")}>{statusText(current)}</span>
                  <div>
                    <button type="button" disabled={!current.configured || busy === provider.id} onClick={() => void validate(provider.id)}>测试连接</button>
                    <button type="button" disabled={!draft.trim() || busy === provider.id} onClick={() => void save(provider.id)}>保存</button>
                    <details><summary aria-label="更多操作">•••</summary><button type="button" disabled={current.source !== "session" || busy === provider.id} onClick={() => void remove(provider.id)}>删除密钥</button></details>
                  </div>
                </div>
              </section>
            );
          })}

          <section className="model-provider-card model-provider-local">
            <div className="model-provider-title"><div><h3>Wan 2.7</h3><p>多参考广告视频生成</p></div><span className={`model-status-dot${status?.wan.apiAvailable ? " is-configured" : ""}`} /></div>
            <div className="model-local-status">{status?.wan.apiAvailable ? "已启用 · 共享百炼 API Key" : "共享百炼 API Key · 当前未就绪"}</div>
          </section>

          <section className="model-provider-card model-provider-local">
            <div className="model-provider-title"><div><h3>Remotion</h3><p>本地成片合成</p></div><span className="model-status-dot is-configured" /></div>
            <div className="model-local-status">本地执行 · 无需 API Key</div>
          </section>
        </div>

        {message ? <div className="model-settings-message" role="status">{message}</div> : null}
        <footer className="model-settings-footer">
          <span>仅当前临时会话保存</span>
          <div><button type="button" onClick={onClose}>取消</button><button type="button" className="is-primary" onClick={onClose}>完成</button></div>
        </footer>
      </aside>
    </div>
  );
}
