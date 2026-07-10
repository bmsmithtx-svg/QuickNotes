export type StudyDocumentUploadStatus = "uploaded" | "processing" | "ready" | "failed";

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
  status: StudyDocumentUploadStatus;
};

export type StudyDocumentSummary = {
  id: string;
  originalFileName: string;
  storedFileName: string;
  fileSize: number;
  mimeType: string;
  title: string;
  className: string | null;
  topic: string | null;
  tags: string[];
  uploadStatus: StudyDocumentUploadStatus;
  pageCount: number | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
};

export type StudyDocumentDetail = StudyDocumentSummary & {
  pageTextCount: number;
};

export type DocumentPagePreview = {
  id: string;
  documentId: string;
  pageNumber: number;
  text: string;
  characterCount: number;
  createdAt: string;
};

export type DocumentChunkPreview = {
  id: string;
  documentId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  characterCount: number;
  tokenEstimate: number;
  createdAt: string;
};

export type DocumentContentResponse = {
  document: StudyDocumentDetail;
  pages: DocumentPagePreview[];
  chunks: DocumentChunkPreview[];
  pageTotal: number;
  chunkTotal: number;
};

export type DocumentUploadResponse = {
  documentId: string;
  originalFileName: string;
  pageCount: number;
  chunkCount: number;
  status: StudyDocumentUploadStatus;
  embeddingStatus?: "skipped_missing_api_key" | "complete" | "failed";
  embeddingError?: string;
};

export type SourceCitation = {
  id: string;
  fileName: string;
  pageNumber: number;
  chunkIndex: number;
  sourceChunk: string;
};

export type ChunkSearchResult = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  originalFileName: string;
  className: string | null;
  topic: string | null;
  tags: string[];
  pageNumber: number;
  chunkIndex: number;
  textPreview: string;
  score: number;
  rank: number;
  ranking: {
    mode: RetrievalMode;
    finalRank: number;
    finalScore: number;
    keywordRank?: number;
    keywordScore?: number;
    semanticRank?: number;
    semanticSimilarity?: number;
  };
  citation: SourceCitation;
};

export type SearchModeAvailability = {
  semanticAvailable: boolean;
  reason?: "missing_api_key" | "missing_embeddings";
  model: string;
};

export type SearchResponse = {
  query: string;
  requestedMode: RetrievalMode | "auto";
  mode: RetrievalMode;
  actualMode: RetrievalMode;
  semantic: SearchModeAvailability;
  resultCount: number;
  ranking: {
    formula: string;
    rrfK?: number;
  };
  filters: {
    documentId?: string;
    className?: string;
    topic?: string;
    tag?: string;
  };
  results: ChunkSearchResult[];
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
