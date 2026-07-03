export type StudyDocumentStatus = "queued" | "processing" | "indexed" | "failed";

export type StudyDocument = {
  id: string;
  fileName: string;
  title: string;
  className: string;
  topic: string;
  source: string;
  tags: string[];
  pageCount: number;
  uploadedAt: string;
  status: StudyDocumentStatus;
};

export type SourceCitation = {
  id: string;
  fileName: string;
  pageNumber: number;
  chunkIndex: number;
  sourceChunk: string;
};

export type RetrievalMode = "semantic" | "keyword" | "hybrid";

export type StudyAnswer = {
  question: string;
  answer: string;
  retrievalMode: RetrievalMode;
  citations: SourceCitation[];
  supportLevel: "supported" | "partial" | "not_found";
};

export const NOT_FOUND_IN_SOURCES =
  "I could not find support for that answer in the uploaded sources.";
