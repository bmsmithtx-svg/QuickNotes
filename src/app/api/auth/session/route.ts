import { getAuthenticatedUserOrUnauthorized, privateJson } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getAuthenticatedUserOrUnauthorized(request);

  if (!auth.ok) {
    return auth.response;
  }

  return privateJson({
    authenticated: true,
    user: {
      email: auth.user.email
    }
  });
}
