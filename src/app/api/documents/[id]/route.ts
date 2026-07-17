import { getAuthenticatedUserOrUnauthorized, privateJson } from "@/lib/server/auth";
import {
  DOCUMENT_UPLOAD_STATUS,
  DocumentLifecycleError,
  deleteStoredDocument
} from "@/lib/server/document-lifecycle";
import {
  getDocumentInclude,
  mapStudyDocumentDetail,
  type DocumentWithCounts
} from "@/lib/server/document-mappers";
import { getPrisma } from "@/lib/server/db";
import {
  parseDocumentMetadataUpdatePayload,
  replaceDocumentTags,
  serializeNormalizedTags,
  type DocumentMetadataUpdate,
  type MetadataTagTransaction
} from "@/lib/server/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
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
    include: getDocumentInclude()
  })) as DocumentWithCounts | null;

  if (!document) {
    return privateJson({ error: "Document not found." }, { status: 404 });
  }

  return privateJson({
    document: mapStudyDocumentDetail(document)
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await getAuthenticatedUserOrUnauthorized(request);

  if (!auth.ok) {
    return auth.response;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return privateJson({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseDocumentMetadataUpdatePayload(payload);

  if (!parsed.ok) {
    return privateJson({ error: parsed.error }, { status: 400 });
  }

  const { id } = await params;
  const prisma = await getPrisma();

  try {
    const document = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.studyDocument.findFirst?.({
        where: {
          id,
          ownerId: auth.user.id
        },
        select: {
          id: true,
          ownerId: true
        }
      });

      if (!existing) {
        return null;
      }

      await transaction.studyDocument.update({
        where: {
          id
        },
        data: toDocumentUpdateData(parsed.value)
      });

      if (parsed.value.tags) {
        await replaceDocumentTags(transaction as unknown as MetadataTagTransaction, id, auth.user.id, parsed.value.tags);
      }

      return (await transaction.studyDocument.findFirst?.({
        where: {
          id,
          ownerId: auth.user.id
        },
        include: getDocumentInclude()
      })) as DocumentWithCounts | null;
    });

    if (!document) {
      return privateJson({ error: "Document not found." }, { status: 404 });
    }

    return privateJson({
      document: mapStudyDocumentDetail(document)
    });
  } catch {
    return privateJson({ error: "Document metadata update failed." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await getAuthenticatedUserOrUnauthorized(_request);

  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await params;
  const prisma = await getPrisma();

  try {
    const result = await deleteStoredDocument({
      prisma,
      documentId: id,
      ownerId: auth.user.id
    });

    if (result.status === "missing") {
      return privateJson({ error: "Document not found." }, { status: 404 });
    }

    return privateJson(result);
  } catch (error) {
    return privateJson(
      {
        documentId: id,
        error:
          error instanceof DocumentLifecycleError && error.stage === "storage_delete"
            ? "Document deletion could not remove the stored source PDF."
            : "Document deletion could not remove the database record.",
        status: DOCUMENT_UPLOAD_STATUS.DELETING
      },
      { status: error instanceof DocumentLifecycleError && error.stage === "storage_delete" ? 503 : 500 }
    );
  }
}

function toDocumentUpdateData(update: DocumentMetadataUpdate) {
  return {
    ...(Object.hasOwn(update, "title") ? { title: update.title } : {}),
    ...(Object.hasOwn(update, "className") ? { className: update.className } : {}),
    ...(Object.hasOwn(update, "topic") ? { topic: update.topic } : {}),
    ...(Object.hasOwn(update, "source") ? { source: update.source } : {}),
    ...(Object.hasOwn(update, "documentDate") ? { documentDate: update.documentDate } : {}),
    ...(update.tags ? { tags: serializeNormalizedTags(update.tags) } : {})
  };
}
