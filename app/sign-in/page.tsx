import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/AuthForm";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { getOptionalUser } from "@/lib/auth/requireUser";


export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  const user = await getOptionalUser();
  if (user) redirect(callbackUrl);

  return <main className="auth-page"><AuthForm mode="sign-in" callbackUrl={callbackUrl} /></main>;
}