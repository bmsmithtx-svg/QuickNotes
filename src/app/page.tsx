import { redirect } from "next/navigation";

import { QuickNotesWorkspace } from "../components/quicknotes-workspace";
import { isAuthenticationError, requireAuthenticatedUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  let user: Awaited<ReturnType<typeof requireAuthenticatedUser>>;

  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (isAuthenticationError(error)) {
      redirect("/auth");
    }

    throw error;
  }

  return <QuickNotesWorkspace userEmail={user.email} />;
}
