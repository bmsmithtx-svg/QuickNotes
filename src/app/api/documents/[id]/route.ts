import { NextResponse } from "next/server";

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
  const { id } = await params;
  const prisma = await getPrisma();
  const document = (await prisma.studyDocument.findUnique({
    where: {
      id
    },
    include: getDocumentInclude()
  })) as DocumentWithCounts | null;

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({
    document: mapStudyDocumentDetail(document)
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseDocumentMetadataUpdatePayload(payload);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { id } = await params;
  const prisma = await getPrisma();

  try {
    const document = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.studyDocument.findUnique({
        where: {
          id
        },
        select: {
          id: true
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
        await replaceDocumentTags(transaction as unknown as MetadataTagTransaction, id, parsed.value.tags);
      }

      return (await transaction.studyDocument.findUnique({
        where: {
          id
        },
        include: getDocumentInclude()
      })) as DocumentWithCounts | null;
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({
      document: mapStudyDocumentDetail(document)
    });
  } catch {
    return NextResponse.json({ error: "Document metadata update failed." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const prisma = await getPrisma();

  try {
    const result = await deleteStoredDocument({
      prisma,
      documentId: id
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
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
    ...(Object.hasOwn(update, "className") ? { className: update.className } : {}),
    ...(Object.hasOwn(update, "topic") ? { topic: update.topic } : {}),
    ...(Object.hasOwn(update, "source") ? { source: update.source } : {}),
    ...(Object.hasOwn(update, "documentDate") ? { documentDate: update.documentDate } : {}),
    ...(update.tags ? { tags: serializeNormalizedTags(update.tags) } : {})
  };
}
