import type {
  DocumentChunkPreview,
  DocumentContentResponse,
  DocumentPagePreview,
  StudyDocumentDetail,
  StudyDocumentSummary,
  StudyDocumentUploadStatus
} from "../types";
import { formatDateOnly, normalizeTagsInput } from "./metadata";

export type StudyDocumentRow = {
  id: string;
  originalFileName: string;
  storedFileName: string;
  fileSize: number;
  mimeType: string;
  title: string;
  className: string | null;
  topic: string | null;
  source: string | null;
  documentDate: Date | string | null;
  tags: string;
  uploadStatus: string;
  pageCount: number | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  tagLinks?: Array<{
    tag: {
      name: string;
      normalizedName: string;
    };
  }>;
};

export type DocumentPageRow = {
  id: string;
  documentId: string;
  pageNumber: number;
  text: string;
  createdAt: Date;
};

export type DocumentChunkRow = {
  id: string;
  documentId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  characterCount: number;
  tokenEstimate: number;
  createdAt: Date;
};

export type DocumentWithCounts = StudyDocumentRow & {
  _count: {
    pages: number;
    chunks: number;
  };
};

export function mapStudyDocumentSummary(document: DocumentWithCounts): StudyDocumentSummary {
  return {
    id: document.id,
    originalFileName: document.originalFileName,
    storedFileName: document.storedFileName,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
    title: document.title,
    className: document.className,
    topic: document.topic,
    source: document.source,
    documentDate: formatDateOnly(document.documentDate),
    tags: getDocumentTagNames(document),
    uploadStatus: toUploadStatus(document.uploadStatus),
    pageCount: document.pageCount,
    chunkCount: document._count.chunks,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

export function mapStudyDocumentDetail(document: DocumentWithCounts): StudyDocumentDetail {
  return {
    ...mapStudyDocumentSummary(document),
    pageTextCount: document._count.pages
  };
}

export function mapDocumentPage(page: DocumentPageRow): DocumentPagePreview {
  return {
    id: page.id,
    documentId: page.documentId,
    pageNumber: page.pageNumber,
    text: page.text,
    characterCount: page.text.length,
    createdAt: page.createdAt.toISOString()
  };
}

export function mapDocumentChunk(chunk: DocumentChunkRow): DocumentChunkPreview {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    pageNumber: chunk.pageNumber,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    characterCount: chunk.characterCount,
    tokenEstimate: chunk.tokenEstimate,
    createdAt: chunk.createdAt.toISOString()
  };
}

export function mapDocumentContentResponse({
  document,
  pages,
  chunks,
  pageTotal,
  chunkTotal
}: {
  document: DocumentWithCounts;
  pages: DocumentPageRow[];
  chunks: DocumentChunkRow[];
  pageTotal: number;
  chunkTotal: number;
}): DocumentContentResponse {
  return {
    document: mapStudyDocumentDetail(document),
    pages: pages.map(mapDocumentPage),
    chunks: chunks.map(mapDocumentChunk),
    pageTotal,
    chunkTotal
  };
}

export function serializeTags(tags: string) {
  const parsedTags = tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return JSON.stringify(normalizeTagsInput(parsedTags).map((tag) => tag.name));
}

export function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags);

    if (Array.isArray(parsed)) {
      return parsed.filter((tag): tag is string => typeof tag === "string");
    }
  } catch {
    return [];
  }

  return [];
}

export function getDocumentInclude() {
  return {
    tagLinks: {
      include: {
        tag: true
      }
    },
    _count: {
      select: {
        pages: true,
        chunks: true
      }
    }
  };
}

function getDocumentTagNames(document: StudyDocumentRow) {
  if (document.tagLinks) {
    return document.tagLinks
      .map((tagLink) => tagLink.tag.name)
      .filter(Boolean)
      .sort((left, right) => left.toLocaleLowerCase().localeCompare(right.toLocaleLowerCase()));
  }

  return parseTags(document.tags);
}

function toUploadStatus(status: string): StudyDocumentUploadStatus {
  if (status === "uploaded" || status === "processing" || status === "ready" || status === "failed") {
    return status;
  }

  return "failed";
}
