import { getAuthenticatedUserOrUnauthorized, privateJson } from "@/lib/server/auth";
import { getDocumentInclude, mapStudyDocumentSummary, type DocumentWithCounts } from "@/lib/server/document-mappers";
import { getPrisma } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getAuthenticatedUserOrUnauthorized(request);

  if (!auth.ok) {
    return auth.response;
  }

  const prisma = await getPrisma();
  const documents = (await prisma.studyDocument.findMany({
    where: {
      ownerId: auth.user.id
    },
    orderBy: {
      createdAt: "desc"
    },
    include: getDocumentInclude()
  })) as DocumentWithCounts[];

  return privateJson({
    documents: documents.map(mapStudyDocumentSummary)
  });
}
