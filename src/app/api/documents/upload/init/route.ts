import { randomUUID } from "node:crypto";

import { getAuthenticatedUserOrUnauthorized, privateJson } from "@/lib/server/auth";
import { DOCUMENT_UPLOAD_STATUS } from "@/lib/server/document-lifecycle";
import {
  formatUploadLimitMessage,
  getDirectMaxPdfUploadBytes,
  isPdfLike,
  parseUploadMetadataFromJson,
  sanitizeOriginalFileName,
  titleFromFileName
} from "@/lib/server/document-upload";
import { getPrisma } from "@/lib/server/db";
import { serializeNormalizedTags } from "@/lib/server/metadata";
import { createPdfObjectKey, getDocumentStorage } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type DirectUploadInitPayload = {
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  contentSha256: string | null;
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

  if (!isRecord(payload)) {
    return privateJson({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const parsed = parseDirectUploadInitPayload(payload);

  if (!parsed.ok) {
    return privateJson({ error: parsed.error }, { status: 400 });
  }

  const maxPdfUploadBytes = getDirectMaxPdfUploadBytes();

  if (parsed.value.fileSize > maxPdfUploadBytes) {
    return privateJson({ error: formatUploadLimitMessage(maxPdfUploadBytes) }, { status: 413 });
  }

  const originalFileName = sanitizeOriginalFileName(parsed.value.originalFileName);

  if (!isPdfLike({ type: parsed.value.mimeType }, originalFileName)) {
    return privateJson({ error: "Only PDF files are supported." }, { status: 415 });
  }

  const metadata = parseUploadMetadataFromJson(payload);

  if (!metadata.ok) {
    return privateJson({ error: metadata.error }, { status: 400 });
  }

  const storage = getDocumentStorage();

  if (storage.provider !== "supabase" || typeof storage.createSignedUploadUrl !== "function") {
    return privateJson({ error: "Direct browser uploads require Supabase Storage." }, { status: 409 });
  }

  const ownerId = auth.user.id;
  const documentId = randomUUID();
  const storageObjectKey = createPdfObjectKey(ownerId, documentId);
  const signedUpload = await storage.createSignedUploadUrl(storageObjectKey);
  const prisma = await getPrisma();

  await prisma.studyDocument.create({
    data: {
      id: documentId,
      ownerId,
      originalFileName,
      storedFileName: storageObjectKey,
      fileSize: parsed.value.fileSize,
      mimeType: parsed.value.mimeType || "application/pdf",
      storageProvider: storage.provider,
      storageBucket: storage.bucket,
      storageObjectKey,
      contentSha256: parsed.value.contentSha256,
      title: metadata.value.title || titleFromFileName(originalFileName),
      className: metadata.value.className,
      topic: metadata.value.topic,
      source: metadata.value.source,
      documentDate: metadata.value.documentDate,
      tags: serializeNormalizedTags(metadata.value.tags),
      uploadStatus: DOCUMENT_UPLOAD_STATUS.UPLOADING
    }
  });

  return privateJson(
    {
      documentId,
      originalFileName,
      bucket: storage.bucket,
      storageObjectKey,
      signedUpload: {
        path: signedUpload.path,
        token: signedUpload.token,
        signedUrl: signedUpload.signedUrl
      }
    },
    { status: 201 }
  );
}

function parseDirectUploadInitPayload(payload: Record<string, unknown>):
  | {
      ok: true;
      value: DirectUploadInitPayload;
    }
  | {
      ok: false;
      error: string;
    } {
  const originalFileName = typeof payload.originalFileName === "string" ? payload.originalFileName.trim() : "";

  if (!originalFileName) {
    return {
      ok: false,
      error: "A PDF file name is required."
    };
  }

  const fileSize = typeof payload.fileSize === "number" ? payload.fileSize : 0;

  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    return {
      ok: false,
      error: "The uploaded PDF is empty."
    };
  }

  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType.trim() : "";
  const contentSha256 = parseContentSha256(payload.contentSha256);

  if (contentSha256 === false) {
    return {
      ok: false,
      error: "PDF checksum must be a SHA-256 hex digest."
    };
  }

  return {
    ok: true,
    value: {
      originalFileName,
      fileSize,
      mimeType,
      contentSha256
    }
  };
}

function parseContentSha256(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value.trim())) {
    return false;
  }

  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
