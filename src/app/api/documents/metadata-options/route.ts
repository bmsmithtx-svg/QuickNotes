import { getAuthenticatedUserOrUnauthorized, privateJson } from "@/lib/server/auth";
import { getPrisma } from "@/lib/server/db";
import { getMetadataOptions } from "@/lib/server/metadata-options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getAuthenticatedUserOrUnauthorized(request);

  if (!auth.ok) {
    return auth.response;
  }

  const prisma = await getPrisma();

  return privateJson(await getMetadataOptions(prisma, auth.user.id));
}
