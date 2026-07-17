import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { requireAuthenticatedUser } from "@/lib/server/auth";
import { shouldRedirectAuthenticatedVisitor } from "@/lib/server/auth-routing";

export const dynamic = "force-dynamic";

type AuthPageProps = {
  searchParams?: Promise<{
    reason?: string;
  }>;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
  if (await shouldRedirectAuthenticatedVisitor(requireAuthenticatedUser)) {
    redirect("/");
  }

  const params = await searchParams;
  const reason = params?.reason === "session-expired" ? "Your session expired. Sign in again." : null;

  return <AuthForm reason={reason} />;
}
