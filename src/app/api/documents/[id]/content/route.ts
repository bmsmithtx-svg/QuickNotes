import { NextResponse } from "next/server";

import {
  mapDocumentContentResponse,
  type DocumentChunkRow,
  type DocumentPageRow,
  type DocumentWithCounts
} from "@/lib/server/document-mappers";
import { getPrisma } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const url = new URL(request.url);
  const pageLimit = getBoundedInteger(url.searchParams.get("pageLimit"), 3, 20);
  const chunkLimit = getBoundedInteger(url.searchParams.get("chunkLimit"), 8, 50);
  const pageOffset = getBoundedInteger(url.searchParams.get("pageOffset"), 0, 5000);
  const chunkOffset = getBoundedInteger(url.searchParams.get("chunkOffset"), 0, 5000);
  const prisma = await getPrisma();

  const document = (await prisma.studyDocument.findUnique({
    where: {
      id
    },
    include: {
      _count: {
        select: {
          pages: true,
          chunks: true
        }
      }
    }
  })) as DocumentWithCounts | null;

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const [pages, chunks] = await Promise.all([
    prisma.documentPage.findMany({
      where: {
        documentId: id
      },
      orderBy: {
        pageNumber: "asc"
      },
      skip: pageOffset,
      take: pageLimit
    }),
    prisma.documentChunk.findMany({
      where: {
        documentId: id
      },
      orderBy: [{ pageNumber: "asc" }, { chunkIndex: "asc" }],
      skip: chunkOffset,
      take: chunkLimit
    })
  ]) as [DocumentPageRow[], DocumentChunkRow[]];

  return NextResponse.json(
    mapDocumentContentResponse({
      document,
      pages,
      chunks,
      pageTotal: document._count.pages,
      chunkTotal: document._count.chunks
    })
  );
}

function getBoundedInteger(value: string | null, fallback: number, max: number) {
  if (value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}
