import { getAuthenticatedUserOrUnauthorized, privateJson } from "@/lib/server/auth";
import {
  DOCUMENT_UPLOAD_STATUS,
  processStoredDocument,
  sanitizeFailureMessage,
  toDocumentUploadStatus
} from "@/lib/server/document-lifecycle";
import { getPrisma } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const auth = await getAuthenticatedUserOrUnauthorized(_request);

  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await params;
  const prisma = await getPrisma();
  const document = (await prisma.studyDocument.findFirst?.({
    where: {
      id,
      ownerId: auth.user.id
    },
    select: {
      id: true,
      uploadStatus: true
    }
  })) as { id: string; uploadStatus: string } | null;

  if (!document) {
    return privateJson({ error: "Document not found." }, { status: 404 });
  }

  const status = toDocumentUploadStatus(document.uploadStatus);

  if (status === DOCUMENT_UPLOAD_STATUS.DELETING) {
    return privateJson({ error: "Document deletion is in progress." }, { status: 409 });
  }

  if (status === DOCUMENT_UPLOAD_STATUS.READY) {
    return privateJson({ error: "Document is already ready." }, { status: 409 });
  }

  try {
    const result = await processStoredDocument({
      prisma,
      documentId: id,
      ownerId: auth.user.id
    });

    return privateJson(result);
  } catch (error) {
    return privateJson(
      {
        documentId: id,
        error: sanitizeFailureMessage(error),
        status: DOCUMENT_UPLOAD_STATUS.FAILED
      },
      { status: 500 }
    );
  }
}
