import { NextResponse } from "next/server";

import { getPrisma } from "@/lib/server/db";
import { searchChunks, type SearchChunksInput } from "@/lib/server/search-index";
import type { SearchResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = getTextParameter(url, "q");

  if (!query) {
    return NextResponse.json({ error: "Search query parameter q is required." }, { status: 400 });
  }

  const input: SearchChunksInput = {
    query,
    documentId: getTextParameter(url, "documentId") ?? undefined,
    className: getTextParameter(url, "class") ?? undefined,
    topic: getTextParameter(url, "topic") ?? undefined,
    tag: getTextParameter(url, "tag") ?? undefined,
    limit: getIntegerParameter(url, "limit")
  };
  const prisma = await getPrisma();
  const results = await searchChunks(prisma, input);
  const response: SearchResponse = {
    query,
    filters: {
      documentId: input.documentId,
      className: input.className,
      topic: input.topic,
      tag: input.tag
    },
    results
  };

  return NextResponse.json(response);
}

function getTextParameter(url: URL, name: string) {
  const value = url.searchParams.get(name)?.trim();

  return value || null;
}

function getIntegerParameter(url: URL, name: string) {
  const value = url.searchParams.get(name);

  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}
