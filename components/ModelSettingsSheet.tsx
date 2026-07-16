"use client";

import { useEffect, useRef, useState } from "react";

import "./model-settings.css";

export type ProviderId = "deepseek" | "qwen-image" | "happyhorse";
type SecretStatus = { configured: boolean; source: "session" | "env" | "none"; lastFour?: string; validated?: boolean };
type HappyHorsePublicStatus = SecretStatus & { capability: "api-available" | "manual-import" | "not-configured"; apiAvailable: boolean; realVideoEnabled?: boolean };
export type ModelSettingsStatus = {
  deepseek: SecretStatus;
  qwenImage: SecretStatus;
  happyHorse: HappyHorsePublicStatus;
  remotion: { configured: false; source: "local"; status: "not-installed" };
};

const providers = [
  { id: "deepseek" as const, statusKey: "deepseek" as const, name: "DeepSeek", role: "策略、分镜与全部提示词", label: "DeepSeek API Key" },
  { id: "qwen-image" as const, statusKey: "qwenImage" as const, name: "Qwen-Image", role: "广告关键帧生成", label: "DashScope API Key" },
  { id: "happyhorse" as const, statusKey: "happyHorse" as const, name: "HappyHorse", role: "百炼主镜头视频生成", label: "DashScope API Key（可复用）" }
] as const;

function statusText(status: SecretStatus & { apiAvailable?: boolean }, provider?: ProviderId) {
  if (provider === "happyhorse" && status.apiAvailable) return "真实调用已就绪 · 末四位 " + status.lastFour;
  if (provider === "happyhorse" && status.configured) return "Key 已保存，需启用真实视频 · 末四位 " + status.lastFour;
  if (provider === "happyhorse") return "未配置";
  if (!status.configured) return "未配置";
  if (status.source === "env") return "使用环境变量";
  if (status.validated === true) return `验证成功 · 末四位 ${status.lastFour}`;
  if (status.validated === false) return `尚未验证 · 末四位 ${status.lastFour}`;
  return `已配置 · 末四位 ${status.lastFour}`;
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
  const [inputs, setInputs] = useState<Record<ProviderId, string>>({ deepseek: "", "qwen-image": "", happyhorse: "" });
  const [visible, setVisible] = useState<Record<ProviderId, boolean>>({ deepseek: false, "qwen-image": false, happyhorse: false });
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/model-settings/status", { cache: "no-store" });
    if (response.ok) onStatusChange((await response.json()) as ModelSettingsStatus);
  }

  useEffect(() => {
    if (!open) {
      setInputs({ deepseek: "", "qwen-image": "", happyhorse: "" });
      setVisible({ deepseek: false, "qwen-image": false, happyhorse: false });
      setMessage(null);
      return;
    }
    void refresh();
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => closeRef.current?.focus());
    if (initialProvider) requestAnimationFrame(() => document.getElementById(`model-key-${initialProvider}`)?.focus());
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [open]);

  async function save(provider: ProviderId) {
    const apiKey = inputs[provider].trim();
    if (!apiKey) return setMessage("请先输入密钥。" );
    setBusy(provider); setMessage(null);
    try {
      const response = await fetch("/api/model-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "保存失败。" );
      setInputs((current) => ({ ...current, [provider]: "" }));
      setMessage("密钥已保存到当前服务端会话。" );
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败。" ); }
    finally { setBusy(null); }
  }

  async function validate(provider: ProviderId) {
    setBusy(provider); setMessage("正在验证连接…" );
    try {
      const response = await fetch(`/api/model-settings/${provider}/validate`, { method: "POST" });
      const result = (await response.json()) as { message?: string };
      setMessage(result.message || "验证完成。" );
      await refresh();
    } catch { setMessage("密钥验证失败，请检查密钥或账户权限。" ); }
    finally { setBusy(null); }
  }

  async function remove(provider: ProviderId) {
    setBusy(provider);
    await fetch(`/api/model-settings/${provider}`, { method: "DELETE" });
    setInputs((current) => ({ ...current, [provider]: "" }));
    setMessage("当前会话密钥已删除。" );
    await refresh();
    setBusy(null);
  }

  if (!open) return null;

  return (
    <div className="model-settings-layer" role="presentation">
      <button className="model-settings-backdrop" type="button" aria-label="关闭模型设置" onClick={onClose} />
      <aside className="model-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
        <header className="model-settings-head">
          <div><h2 id="model-settings-title">模型 API 设置</h2><p>配置当前会话使用的模型密钥。密钥仅发送到服务端，不会显示在页面或模型调用日志中。</p></div>
          <button ref={closeRef} className="model-settings-close" type="button" onClick={onClose} aria-label="关闭"><span /><span /></button>
        </header>

        <div className="model-security-note"><span className="model-shield-icon" aria-hidden="true" /><p>{guidance || "密钥仅在当前服务端会话中使用，服务重启后自动清除。"}</p></div>

        <div className="model-provider-list">
          {providers.map((provider) => {
            const current = status?.[provider.statusKey] ?? { configured: false, source: "none" as const };
            return (
              <section className={`model-provider-card ${initialProvider === provider.id ? "is-targeted" : ""}`} key={provider.id} data-provider={provider.id}>
                <div className="model-provider-title"><div><h3>{provider.name}</h3><p>{provider.role}</p></div><span className={`model-status-dot ${current.configured ? "is-configured" : ""}`} /></div>
                <label htmlFor={`model-key-${provider.id}`}>{provider.label}</label>
                <div className="model-key-field">
                  <input
                    id={`model-key-${provider.id}`}
                    type={visible[provider.id] ? "text" : "password"}
                    value={inputs[provider.id]}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder={current.configured ? "输入新密钥以替换" : "输入 API Key"}
                    onChange={(event) => setInputs((value) => ({ ...value, [provider.id]: event.target.value }))}
                  />
                  <button type="button" aria-label={visible[provider.id] ? "隐藏输入" : "显示输入"} onClick={() => setVisible((value) => ({ ...value, [provider.id]: !value[provider.id] }))}><span className={`model-eye ${visible[provider.id] ? "is-open" : ""}`} /></button>
                </div>
                <div className="model-provider-actions">
                  <span className={`model-provider-state ${current.validated === false && current.configured ? "is-pending" : ""}`}>{statusText(current, provider.id)}</span>
                  <div><button type="button" disabled={!current.configured || busy === provider.id} onClick={() => void validate(provider.id)}>{"测试连接"}</button><button type="button" disabled={!inputs[provider.id].trim() || busy === provider.id} onClick={() => void save(provider.id)}>保存</button><details><summary aria-label="更多操作">•••</summary><button type="button" disabled={current.source !== "session"} onClick={() => void remove(provider.id)}>删除密钥</button></details></div>
                </div>
              </section>
            );
          })}

          <section className="model-provider-card model-provider-local"><div className="model-provider-title"><div><h3>Remotion</h3><p>本地成片合成</p></div><span className="model-status-dot is-configured" /></div><div className="model-local-status">未安装 · 无需 API Key</div></section>
        </div>

        {message ? <div className="model-settings-message" role="status">{message}</div> : null}
        <footer className="model-settings-footer"><span>仅当前会话保存</span><div><button type="button" onClick={onClose}>取消</button><button type="button" className="is-primary" onClick={onClose}>完成</button></div></footer>
      </aside>
    </div>
  );
}

