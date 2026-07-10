import { NextResponse } from "next/server";

import { mapStudyDocumentDetail, type DocumentWithCounts } from "@/lib/server/document-mappers";
import { getPrisma } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
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

  return NextResponse.json({
    document: mapStudyDocumentDetail(document)
  });
}
