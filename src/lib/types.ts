export type StudyDocumentUploadStatus = "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | "DELETING";

export type StudyDocument = {
  id: string;
  fileName: string;
  title: string;
  className: string;
  topic: string;
  source: string;
  documentDate: string;
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
  storageProvider: string;
  storageBucket: string;
  storageObjectKey: string;
  contentSha256: string | null;
  title: string;
  className: string | null;
  topic: string | null;
  source: string | null;
  documentDate: string | null;
  tags: string[];
  uploadStatus: StudyDocumentUploadStatus;
  pageCount: number | null;
  chunkCount: number;
  failureStage: string | null;
  failureReason: string | null;
  processingAttemptCount: number;
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
  source: string | null;
  documentDate: string | null;
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
  filters: AppliedRetrievalFilters;
  results: ChunkSearchResult[];
};

export type RetrievalMode = "semantic" | "keyword" | "hybrid";

export type RetrievalFilters = {
  documentIds?: string[];
  classNames?: string[];
  topics?: string[];
  sources?: string[];
  tags?: string[];
  documentDateFrom?: string;
  documentDateTo?: string;
};

export type AppliedRetrievalFilters = {
  documentIds: string[];
  classNames: string[];
  topics: string[];
  sources: string[];
  tags: string[];
  documentDateFrom?: string;
  documentDateTo?: string;
  tagMatch: "any";
};

export type MetadataOption = {
  value: string;
  count: number;
};

export type MetadataOptionsResponse = {
  classes: MetadataOption[];
  topics: MetadataOption[];
  sources: MetadataOption[];
  tags: MetadataOption[];
};

export type AnswerStatus = "answered" | "insufficient_evidence";

export type AnswerCitation = {
  id: number;
  marker: string;
  documentId: string;
  documentTitle: string;
  documentFileName: string;
  pageNumber: number;
  chunkId: string;
  chunkIndex: number;
  sourceText: string;
  retrievalRank: number;
  retrievalScore: number;
  retrievalMetadata: ChunkSearchResult["ranking"];
};

export type AnswerRetrievedChunk = ChunkSearchResult & {
  citationId: number;
  marker: string;
  sourceText: string;
};

export type AnswerResponse = {
  status: AnswerStatus;
  answer: string;
  citations: AnswerCitation[];
  retrievedChunks: AnswerRetrievedChunk[];
  retrievalMode: RetrievalMode;
  filters: AppliedRetrievalFilters;
  model: string;
};

export type StudyAnswer = {
  question: string;
  answer: string;
  retrievalMode: RetrievalMode;
  citations: SourceCitation[];
  supportLevel: "supported" | "partial" | "not_found";
};

export const NOT_FOUND_IN_SOURCES =
  "I could not find support for that answer in the uploaded sources.";
