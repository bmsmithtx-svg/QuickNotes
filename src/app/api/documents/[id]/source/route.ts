import { NextResponse } from "next/server";

import { DOCUMENT_UPLOAD_STATUS, toDocumentUploadStatus } from "@/lib/server/document-lifecycle";
import { getPrisma } from "@/lib/server/db";
import { getDocumentStorageForRecord, SIGNED_SOURCE_URL_TTL_SECONDS } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type SourceDocumentRecord = {
  id: string;
  originalFileName: string;
  mimeType: string;
  uploadStatus: string;
  storageProvider: string;
  storageBucket: string;
  storageObjectKey: string;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const prisma = await getPrisma();
  const document = (await prisma.studyDocument.findUnique({
    where: {
      id
    },
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      uploadStatus: true,
      storageProvider: true,
      storageBucket: true,
      storageObjectKey: true
    }
  })) as SourceDocumentRecord | null;

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  if (toDocumentUploadStatus(document.uploadStatus) === DOCUMENT_UPLOAD_STATUS.DELETING) {
    return NextResponse.json({ error: "Document deletion is in progress." }, { status: 409 });
  }

  const storage = getDocumentStorageForRecord(document);

  try {
    if (!(await storage.exists(document.storageObjectKey))) {
      return NextResponse.json({ error: "Stored source PDF is missing." }, { status: 404 });
    }

    const signedUrl = await storage.createSignedUrl(document.storageObjectKey, {
      expiresInSeconds: SIGNED_SOURCE_URL_TTL_SECONDS
    });

    if (signedUrl) {
      return NextResponse.redirect(signedUrl);
    }

    const buffer = await storage.readPdf(document.storageObjectKey);
    const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    return new Response(body, {
      headers: {
        "Content-Type": document.mimeType || "application/pdf",
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.originalFileName)}`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch {
    return NextResponse.json({ error: "Could not open stored source PDF." }, { status: 500 });
  }
}
