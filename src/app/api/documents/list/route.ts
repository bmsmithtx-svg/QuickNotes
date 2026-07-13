import { NextResponse } from "next/server";

import { getDocumentInclude, mapStudyDocumentSummary, type DocumentWithCounts } from "@/lib/server/document-mappers";
import { getPrisma } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const prisma = await getPrisma();
  const documents = (await prisma.studyDocument.findMany({
    orderBy: {
      createdAt: "desc"
    },
    include: getDocumentInclude()
  })) as DocumentWithCounts[];

  return NextResponse.json({
    documents: documents.map(mapStudyDocumentSummary)
  });
}
