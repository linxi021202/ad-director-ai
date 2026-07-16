import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { safeCallbackUrl } from "./callback-url";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
};

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";

  constructor(message = "请先登录后继续。") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function getOptionalUser(): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (!session?.user) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name
  };
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getOptionalUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requirePageUser(callbackUrl: string): Promise<AuthenticatedUser> {
  const user = await getOptionalUser();
  if (!user) {
    redirect("/sign-in?callbackUrl=" + encodeURIComponent(safeCallbackUrl(callbackUrl)));
  }
  return user;
}