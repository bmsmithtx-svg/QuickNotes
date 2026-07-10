// @ts-nocheck
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { chunkPageText } from "@/lib/chunking";
import { serializeTags } from "@/lib/server/document-mappers";
import { getPrisma } from "@/lib/server/db";
import { extractPdfTextByPage } from "@/lib/server/pdf-extraction";
import { ensureChunkSearchIndex, syncDocumentSearchIndex } from "@/lib/server/search-index";
import { ensureLocalStorage, getStoredPdfPath } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  let documentId: string | null = null;

  try {
    const prisma = await getPrisma();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file is required." }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "The uploaded PDF is empty." }, { status: 400 });
    }

    if (file.size > MAX_PDF_UPLOAD_BYTES) {
      return NextResponse.json({ error: "PDF uploads are limited to 25 MB for local development." }, { status: 413 });
    }

    const originalFileName = sanitizeOriginalFileName(file.name);

    if (!isPdfLike(file, originalFileName)) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!hasPdfHeader(buffer)) {
      return NextResponse.json({ error: "The uploaded file is not a valid PDF." }, { status: 415 });
    }

    await ensureLocalStorage();

    const storedFileName = `${randomUUID()}.pdf`;
    await writeFile(getStoredPdfPath(storedFileName), buffer);

    const document = (await prisma.studyDocument.create({
      data: {
        originalFileName,
        storedFileName,
        fileSize: file.size,
        mimeType: file.type || "application/pdf",
        title: getTextField(formData, "title") || titleFromFileName(originalFileName),
        className: getTextField(formData, "className"),
        topic: getTextField(formData, "topic"),
        tags: serializeTags(getTextField(formData, "tags") ?? ""),
        uploadStatus: "uploaded"
      }
    })) as { id: string };
    documentId = document.id;

    await prisma.studyDocument.update({
      where: {
        id: document.id
      },
      data: {
        uploadStatus: "processing",
        failureReason: null
      }
    });

    const extractedPdf = await extractPdfTextByPage(buffer);
    const pageRows = extractedPdf.pages.map((page) => ({
      documentId: document.id,
      pageNumber: page.pageNumber,
      text: page.text
    }));
    const chunkRows = extractedPdf.pages.flatMap((page) =>
      chunkPageText({
        documentId: document.id,
        pageNumber: page.pageNumber,
        text: page.text
      })
    );

    await ensureChunkSearchIndex(prisma);

    await prisma.$transaction(async (transaction) => {
      if (pageRows.length > 0) {
        await transaction.documentPage.createMany({
          data: pageRows
        });
      }

      if (chunkRows.length > 0) {
        await transaction.documentChunk.createMany({
          data: chunkRows
        });
      }

      const searchableChunks = await transaction.documentChunk.findMany({
        where: {
          documentId: document.id
        },
        select: {
          id: true,
          documentId: true,
          text: true
        }
      });

      await syncDocumentSearchIndex(transaction, document.id, searchableChunks);

      await transaction.studyDocument.update({
        where: {
          id: document.id
        },
        data: {
          uploadStatus: "ready",
          pageCount: extractedPdf.pageCount,
          failureReason: null
        }
      });
    });

    return NextResponse.json(
      {
        documentId: document.id,
        originalFileName,
        pageCount: extractedPdf.pageCount,
        chunkCount: chunkRows.length,
        status: "ready"
      },
      { status: 201 }
    );
  } catch {
    if (documentId) {
      await markDocumentFailed(documentId);
    }

    return NextResponse.json(
      {
        documentId,
        error: "PDF processing failed.",
        status: "failed"
      },
      { status: 500 }
    );
  }
}

async function markDocumentFailed(documentId: string) {
  try {
    const prisma = await getPrisma();

    await prisma.studyDocument.update({
      where: {
        id: documentId
      },
      data: {
        uploadStatus: "failed",
        failureReason: "PDF processing failed."
      }
    });
  } catch {
    // Keep the public upload error safe even if failure-state persistence also fails.
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

function isPdfLike(file: File, originalFileName: string) {
  const mimeType = file.type.toLowerCase();

  return originalFileName.toLowerCase().endsWith(".pdf") && (!mimeType || mimeType === "application/pdf");
}

function hasPdfHeader(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("utf8") === "%PDF-";
}
