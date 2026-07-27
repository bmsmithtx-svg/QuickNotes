import { randomUUID } from "node:crypto";

import { getAuthenticatedUserOrUnauthorized, privateJson } from "@/lib/server/auth";
import {
  DOCUMENT_UPLOAD_STATUS,
  DocumentLifecycleError,
  markDocumentFailed,
  processStoredDocument,
  type DocumentLifecycleStage
} from "@/lib/server/document-lifecycle";
import { getPrisma } from "@/lib/server/db";
import {
  formatMegabytes,
  formatUploadLimitMessage,
  getDirectMaxPdfUploadBytes,
  getRouteMaxPdfUploadBytes,
  hasPdfHeader,
  isPdfLike,
  parseUploadMetadataFromFormData,
  sanitizeOriginalFileName,
  titleFromFileName
} from "@/lib/server/document-upload";
import { serializeNormalizedTags } from "@/lib/server/metadata";
import {
  createPdfObjectKey,
  getDocumentStorage,
  sha256Hex
} from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = await getAuthenticatedUserOrUnauthorized(request);

  if (!auth.ok) {
    return auth.response;
  }

  const storage = getDocumentStorage();
  const directUploadEnabled = storage.provider === "supabase" && typeof storage.createSignedUploadUrl === "function";
  const maxPdfUploadBytes = directUploadEnabled ? getDirectMaxPdfUploadBytes() : getRouteMaxPdfUploadBytes();

  return privateJson({
    maxPdfUploadBytes,
    maxPdfUploadMegabytes: formatMegabytes(maxPdfUploadBytes),
    uploadMode: directUploadEnabled ? "direct" : "route",
    storageProvider: storage.provider
  });
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedUserOrUnauthorized(request);

  if (!auth.ok) {
    return auth.response;
  }

  let documentId: string | null = null;
  let failureStage: DocumentLifecycleStage = "processing";

  try {
    const prisma = await getPrisma();
    const storage = getDocumentStorage();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return privateJson({ error: "A PDF file is required." }, { status: 400 });
    }

    if (file.size <= 0) {
      return privateJson({ error: "The uploaded PDF is empty." }, { status: 400 });
    }

    const maxPdfUploadBytes = getRouteMaxPdfUploadBytes();

    if (file.size > maxPdfUploadBytes) {
      return privateJson(
        { error: formatUploadLimitMessage(maxPdfUploadBytes) },
        { status: 413 }
      );
    }

    const originalFileName = sanitizeOriginalFileName(file.name);

    if (!isPdfLike(file, originalFileName)) {
      return privateJson({ error: "Only PDF files are supported." }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!hasPdfHeader(buffer)) {
      return privateJson({ error: "The uploaded file is not a valid PDF." }, { status: 415 });
    }

    const metadata = parseUploadMetadataFromFormData(formData);

    if (!metadata.ok) {
      return privateJson({ error: metadata.error }, { status: 400 });
    }

    const contentSha256 = sha256Hex(buffer);
    const ownerId = auth.user.id;
    documentId = randomUUID();
    const storageObjectKey = createPdfObjectKey(ownerId, documentId);

    const document = (await prisma.studyDocument.create({
      data: {
        id: documentId,
        ownerId,
        originalFileName,
        storedFileName: storageObjectKey,
        fileSize: file.size,
        mimeType: file.type || "application/pdf",
        storageProvider: storage.provider,
        storageBucket: storage.bucket,
        storageObjectKey,
        contentSha256,
        title: metadata.value.title || titleFromFileName(originalFileName),
        className: metadata.value.className,
        topic: metadata.value.topic,
        source: metadata.value.source,
        documentDate: metadata.value.documentDate,
        tags: serializeNormalizedTags(metadata.value.tags),
        uploadStatus: DOCUMENT_UPLOAD_STATUS.UPLOADING
      }
    })) as { id: string };

    failureStage = "storage_upload";
    await storage.uploadPdf({
      key: storageObjectKey,
      body: buffer,
      contentType: file.type || "application/pdf",
      contentSha256
    });

    await prisma.studyDocument.update({
      where: {
        id: document.id
      },
      data: {
        storageConfirmedAt: new Date(),
        storageProvider: storage.provider,
        storageBucket: storage.bucket,
        storageObjectKey,
        contentSha256,
        failureReason: null
      }
    });

    const processingResult = await processStoredDocument({
      prisma,
      storage,
      documentId: document.id,
      ownerId,
      tags: metadata.value.tags
    });

    return privateJson(
      {
        documentId: document.id,
        originalFileName,
        pageCount: processingResult.pageCount,
        chunkCount: processingResult.chunkCount,
        status: processingResult.status,
        embeddingStatus: processingResult.embeddingStatus
      },
      { status: 201 }
    );
  } catch (error) {
    if (!documentId && isRequestEntityTooLargeError(error)) {
      return privateJson({ error: formatUploadLimitMessage(getRouteMaxPdfUploadBytes()) }, { status: 413 });
    }

    if (documentId) {
      const prisma = await getPrisma();

      await markDocumentFailed(
        prisma,
        documentId,
        error instanceof DocumentLifecycleError ? error.stage : failureStage,
        error
      );
    }

    return privateJson(
      {
        documentId,
        error: "PDF processing failed.",
        status: DOCUMENT_UPLOAD_STATUS.FAILED
      },
      { status: 500 }
    );
  }
}

function isRequestEntityTooLargeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("request entity too large") ||
    message.includes("payload too large") ||
    (message.includes("body") && message.includes("too large"))
  );
}
