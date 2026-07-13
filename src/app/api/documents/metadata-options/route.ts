import { NextResponse } from "next/server";

import { getPrisma } from "@/lib/server/db";
import { getMetadataOptions } from "@/lib/server/metadata-options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const prisma = await getPrisma();

  return NextResponse.json(await getMetadataOptions(prisma));
}
