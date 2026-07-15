import path from "node:path";

import { NextResponse } from "next/server";

import {
  DOCUMENT_UPLOAD_STATUS,
  DocumentLifecycleError,
  markDocumentFailed,
  processStoredDocument,
  type DocumentLifecycleStage
} from "@/lib/server/document-lifecycle";
import { getPrisma } from "@/lib/server/db";
import {
  normalizeTagsInput,
  parseDateOnly,
  serializeNormalizedTags
} from "@/lib/server/metadata";
import {
  createPdfObjectKey,
  getDocumentStorage,
  sha256Hex
} from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOCAL_MAX_PDF_UPLOAD_BYTES = 25 * 1024 * 1024;
const VERCEL_SAFE_MAX_PDF_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  let documentId: string | null = null;
  let failureStage: DocumentLifecycleStage = "processing";

  try {
    const prisma = await getPrisma();
    const storage = getDocumentStorage();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file is required." }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "The uploaded PDF is empty." }, { status: 400 });
    }

    const maxPdfUploadBytes = getMaxPdfUploadBytes();

    if (file.size > maxPdfUploadBytes) {
      return NextResponse.json(
        { error: `PDF uploads are limited to ${formatMegabytes(maxPdfUploadBytes)} MB for this deployment.` },
        { status: 413 }
      );
    }

    const originalFileName = sanitizeOriginalFileName(file.name);

    if (!isPdfLike(file, originalFileName)) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!hasPdfHeader(buffer)) {
      return NextResponse.json({ error: "The uploaded file is not a valid PDF." }, { status: 415 });
    }

    const metadata = parseUploadMetadata(formData);

    if (!metadata.ok) {
      return NextResponse.json({ error: metadata.error }, { status: 400 });
    }

    const contentSha256 = sha256Hex(buffer);
    const storageObjectKey = createPdfObjectKey();

    const document = (await prisma.studyDocument.create({
      data: {
        originalFileName,
        storedFileName: storageObjectKey,
        fileSize: file.size,
        mimeType: file.type || "application/pdf",
        storageProvider: storage.provider,
        storageBucket: storage.bucket,
        storageObjectKey,
        contentSha256,
        title: getTextField(formData, "title") || titleFromFileName(originalFileName),
        className: metadata.value.className,
        topic: metadata.value.topic,
        source: metadata.value.source,
        documentDate: metadata.value.documentDate,
        tags: serializeNormalizedTags(metadata.value.tags),
        uploadStatus: DOCUMENT_UPLOAD_STATUS.UPLOADING
      }
    })) as { id: string };
    documentId = document.id;

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
      tags: metadata.value.tags
    });

    return NextResponse.json(
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
    if (documentId) {
      const prisma = await getPrisma();

      await markDocumentFailed(
        prisma,
        documentId,
        error instanceof DocumentLifecycleError ? error.stage : failureStage,
        error
      );
    }

    return NextResponse.json(
      {
        documentId,
        error: "PDF processing failed.",
        status: DOCUMENT_UPLOAD_STATUS.FAILED
      },
      { status: 500 }
    );
  }
}

function sanitizeOriginalFileName(fileName: string) {
  const baseName = fileName.split(/[/\\]/).pop() || "document.pdf";
  const safeName = path.basename(baseName).replace(/[^\w .()-]+/g, "_").trim();

  return safeName || "document.pdf";
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim() || "Untitled PDF";
}

function getTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function parseUploadMetadata(formData: FormData):
  | {
      ok: true;
      value: {
        className: string | null;
        topic: string | null;
        source: string | null;
        documentDate: Date | null;
        tags: ReturnType<typeof normalizeTagsInput>;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  try {
    return {
      ok: true,
      value: {
        className: getTextField(formData, "className"),
        topic: getTextField(formData, "topic"),
        source: getTextField(formData, "source"),
        documentDate: parseDateOnly(getTextField(formData, "documentDate"), "documentDate"),
        tags: normalizeTagsInput(splitTagsField(getTextField(formData, "tags") ?? ""))
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid metadata."
    };
  }
}

function splitTagsField(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isPdfLike(file: File, originalFileName: string) {
  const mimeType = file.type.toLowerCase();

  return originalFileName.toLowerCase().endsWith(".pdf") && (!mimeType || mimeType === "application/pdf");
}

function hasPdfHeader(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("utf8") === "%PDF-";
}

function getMaxPdfUploadBytes(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.QUICKNOTES_MAX_PDF_UPLOAD_BYTES?.trim();

  if (configured) {
    const parsed = Number.parseInt(configured, 10);

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return env.VERCEL ? VERCEL_SAFE_MAX_PDF_UPLOAD_BYTES : LOCAL_MAX_PDF_UPLOAD_BYTES;
}

function formatMegabytes(bytes: number) {
  return Math.floor((bytes / (1024 * 1024)) * 10) / 10;
}
