import path from "node:path";

import { normalizeTagsInput, parseDateOnly } from "./metadata";

export const DEFAULT_MAX_PDF_UPLOAD_BYTES = 25 * 1024 * 1024;
export const VERCEL_SAFE_ROUTE_MAX_PDF_UPLOAD_BYTES = 4 * 1024 * 1024;

export type UploadMetadata = {
  title: string | null;
  className: string | null;
  topic: string | null;
  source: string | null;
  documentDate: Date | null;
  tags: ReturnType<typeof normalizeTagsInput>;
};

export type PdfLikeFile = {
  type?: string;
};

export function getRouteMaxPdfUploadBytes(env: NodeJS.ProcessEnv = process.env) {
  return getConfiguredMaxPdfUploadBytes(env) ?? (env.VERCEL ? VERCEL_SAFE_ROUTE_MAX_PDF_UPLOAD_BYTES : DEFAULT_MAX_PDF_UPLOAD_BYTES);
}

export function getDirectMaxPdfUploadBytes(env: NodeJS.ProcessEnv = process.env) {
  return getConfiguredMaxPdfUploadBytes(env) ?? DEFAULT_MAX_PDF_UPLOAD_BYTES;
}

export function getConfiguredMaxPdfUploadBytes(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.QUICKNOTES_MAX_PDF_UPLOAD_BYTES?.trim();

  if (!configured) {
    return null;
  }

  const parsed = Number.parseInt(configured, 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function formatMegabytes(bytes: number) {
  return Math.floor((bytes / (1024 * 1024)) * 10) / 10;
}

export function formatUploadLimitMessage(maxPdfUploadBytes: number) {
  return `PDF uploads are limited to ${formatMegabytes(maxPdfUploadBytes)} MB for this deployment.`;
}

export function sanitizeOriginalFileName(fileName: string) {
  const baseName = fileName.split(/[/\\]/).pop() || "document.pdf";
  const safeName = path.basename(baseName).replace(/[^\w .()-]+/g, "_").trim();

  return safeName || "document.pdf";
}

export function titleFromFileName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim() || "Untitled PDF";
}

export function isPdfLike(file: PdfLikeFile, originalFileName: string) {
  const mimeType = file.type?.toLowerCase() ?? "";

  return originalFileName.toLowerCase().endsWith(".pdf") && (!mimeType || mimeType === "application/pdf");
}

export function hasPdfHeader(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("utf8") === "%PDF-";
}

export function parseUploadMetadataFromFormData(formData: FormData) {
  return parseUploadMetadataFieldValues({
    title: getFormDataTextField(formData, "title"),
    className: getFormDataTextField(formData, "className"),
    topic: getFormDataTextField(formData, "topic"),
    source: getFormDataTextField(formData, "source"),
    documentDate: getFormDataTextField(formData, "documentDate"),
    tags: splitTagsField(getFormDataTextField(formData, "tags") ?? "")
  });
}

export function parseUploadMetadataFromJson(payload: Record<string, unknown>) {
  return parseUploadMetadataFieldValues({
    title: getJsonTextField(payload, "title"),
    className: getJsonTextField(payload, "className"),
    topic: getJsonTextField(payload, "topic"),
    source: getJsonTextField(payload, "source"),
    documentDate: getJsonTextField(payload, "documentDate"),
    tags: getJsonTagsField(payload, "tags")
  });
}

function parseUploadMetadataFieldValues(fields: {
  title: string | null;
  className: string | null;
  topic: string | null;
  source: string | null;
  documentDate: string | null;
  tags: string[];
}):
  | {
      ok: true;
      value: UploadMetadata;
    }
  | {
      ok: false;
      error: string;
    } {
  try {
    return {
      ok: true,
      value: {
        title: fields.title,
        className: fields.className,
        topic: fields.topic,
        source: fields.source,
        documentDate: parseDateOnly(fields.documentDate, "documentDate"),
        tags: normalizeTagsInput(fields.tags)
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid metadata."
    };
  }
}

function getFormDataTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);

  if (typeof value !== "string") {
    return null;
  }

  return normalizeTextField(value);
}

function getJsonTextField(payload: Record<string, unknown>, fieldName: string) {
  const value = payload[fieldName];

  if (typeof value !== "string") {
    return null;
  }

  return normalizeTextField(value);
}

function normalizeTextField(value: string) {
  const trimmed = value.trim();

  return trimmed || null;
}

function getJsonTagsField(payload: Record<string, unknown>, fieldName: string) {
  const value = payload[fieldName];

  if (Array.isArray(value)) {
    return value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return splitTagsField(value);
  }

  return [];
}

function splitTagsField(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}
