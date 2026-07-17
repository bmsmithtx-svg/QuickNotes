import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { isAuthenticationError, requireAuthenticatedUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

type AuthPageProps = {
  searchParams?: Promise<{
    reason?: string;
  }>;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
  try {
    await requireAuthenticatedUser();
    redirect("/");
  } catch (error) {
    if (!isAuthenticationError(error)) {
      throw error;
    }
  }

  const params = await searchParams;
  const reason = params?.reason === "session-expired" ? "Your session expired. Sign in again." : null;

  return <AuthForm reason={reason} />;
}
