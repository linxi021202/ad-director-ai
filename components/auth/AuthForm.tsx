"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { signInSchema, signUpSchema } from "@/lib/auth/validation";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
  callbackUrl?: string;
};

export function AuthForm({ mode, callbackUrl }: AuthFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const target = safeCallbackUrl(callbackUrl);
  const isSignUp = mode === "sign-up";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const form = new FormData(event.currentTarget);
    const values = {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? "")
    };
    const signUpInput = isSignUp ? signUpSchema.safeParse(values) : null;
    const signInInput = isSignUp ? null : signInSchema.safeParse(values);

    if (signUpInput && !signUpInput.success) {
      setError(signUpInput.error.issues[0]?.message ?? "请检查输入内容。");
      return;
    }
    if (signInInput && !signInInput.success) {
      setError(signInInput.error.issues[0]?.message ?? "请检查输入内容。");
      return;
    }

    setLoading(true);
    try {
      if (signUpInput?.success) {
        const result = await authClient.signUp.email({
          name: signUpInput.data.name,
          email: signUpInput.data.email,
          password: signUpInput.data.password
        });
        if (result.error) {
          setError("无法完成注册，请检查信息或改用登录。");
          return;
        }
      } else if (signInInput?.success) {
        const result = await authClient.signIn.email({
          email: signInInput.data.email,
          password: signInInput.data.password
        });
        if (result.error) {
          setError("邮箱或密码不正确。");
          return;
        }
      }

      router.replace(target);
      router.refresh();
    } catch {
      setError("认证服务暂时不可用，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  const alternateHref = isSignUp
    ? "/sign-in?callbackUrl=" + encodeURIComponent(target)
    : "/sign-up?callbackUrl=" + encodeURIComponent(target);

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <div className="auth-form__heading">
        <span>AdDirector AI</span>
        <h1>{isSignUp ? "创建账号" : "欢迎回来"}</h1>
        <p>{isSignUp ? "注册后进入广告生成工作台。" : "登录后继续你的广告生成流程。"}</p>
      </div>

      {isSignUp ? <label><span>名称</span><input name="name" type="text" autoComplete="name" disabled={loading} required /></label> : null}
      <label><span>邮箱</span><input name="email" type="email" autoComplete="email" disabled={loading} required /></label>
      <label>
        <span>密码</span>
        <input name="password" type="password" autoComplete={isSignUp ? "new-password" : "current-password"} minLength={8} disabled={loading} required />
      </label>
      {isSignUp ? <label><span>确认密码</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} disabled={loading} required /></label> : null}

      {error ? <p className="auth-form__error" role="alert">{error}</p> : null}
      <button type="submit" disabled={loading}>{loading ? "处理中..." : isSignUp ? "注册并进入" : "登录"}</button>
      <p className="auth-form__switch">
        {isSignUp ? "已有账号？" : "还没有账号？"}
        <Link href={alternateHref}>{isSignUp ? "去登录" : "去注册"}</Link>
      </p>
    </form>
  );
}