import { getAuthenticatedUserOrUnauthorized, privateJson } from "@/lib/server/auth";
import {
  DOCUMENT_UPLOAD_STATUS,
  processStoredDocument,
  sanitizeFailureMessage,
  toDocumentUploadStatus
} from "@/lib/server/document-lifecycle";
import { getPrisma } from "@/lib/server/db";
import { getDocumentStorageForRecord } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DirectUploadFinalizePayload = {
  documentId: string;
};

type DirectUploadDocumentRecord = {
  id: string;
  ownerId: string;
  originalFileName: string;
  uploadStatus: string;
  storageProvider: string;
  storageBucket: string;
  storageObjectKey: string;
};

export async function POST(request: Request) {
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

  const parsed = parseDirectUploadFinalizePayload(payload);

  if (!parsed.ok) {
    return privateJson({ error: parsed.error }, { status: 400 });
  }

  const prisma = await getPrisma();
  const document = (await prisma.studyDocument.findFirst?.({
    where: {
      id: parsed.value.documentId,
      ownerId: auth.user.id
    },
    select: {
      id: true,
      ownerId: true,
      originalFileName: true,
      uploadStatus: true,
      storageProvider: true,
      storageBucket: true,
      storageObjectKey: true
    }
  })) as DirectUploadDocumentRecord | null;

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

  if (status === DOCUMENT_UPLOAD_STATUS.PROCESSING) {
    return privateJson({ error: "Document processing is already in progress." }, { status: 409 });
  }

  const storage = getDocumentStorageForRecord(document);

  if (storage.provider !== "supabase") {
    return privateJson({ error: "Direct browser uploads require Supabase Storage." }, { status: 409 });
  }

  try {
    const processingResult = await processStoredDocument({
      prisma,
      storage,
      documentId: document.id,
      ownerId: auth.user.id
    });

    await prisma.studyDocument.update({
      where: {
        id: document.id
      },
      data: {
        storageConfirmedAt: new Date()
      }
    });

    return privateJson(
      {
        documentId: document.id,
        originalFileName: document.originalFileName,
        pageCount: processingResult.pageCount,
        chunkCount: processingResult.chunkCount,
        status: processingResult.status,
        embeddingStatus: processingResult.embeddingStatus
      },
      { status: 201 }
    );
  } catch (error) {
    return privateJson(
      {
        documentId: document.id,
        error: sanitizeFailureMessage(error),
        status: DOCUMENT_UPLOAD_STATUS.FAILED
      },
      { status: 500 }
    );
  }
}

function parseDirectUploadFinalizePayload(payload: unknown):
  | {
      ok: true;
      value: DirectUploadFinalizePayload;
    }
  | {
      ok: false;
      error: string;
    } {
  if (!isRecord(payload)) {
    return {
      ok: false,
      error: "Request body must be a JSON object."
    };
  }

  const documentId = typeof payload.documentId === "string" ? payload.documentId.trim() : "";

  if (!documentId) {
    return {
      ok: false,
      error: "Document id is required."
    };
  }

  return {
    ok: true,
    value: {
      documentId
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
