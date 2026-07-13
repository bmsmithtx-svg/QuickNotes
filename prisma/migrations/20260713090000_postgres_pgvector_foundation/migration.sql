-- PostgreSQL/Supabase baseline for QuickNotes.
-- pgvector stores normalized chunk embeddings for database-side semantic ranking.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "StudyDocument" (
    "id" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "className" TEXT,
    "topic" TEXT,
    "source" TEXT,
    "documentDate" DATE,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "uploadStatus" TEXT NOT NULL DEFAULT 'uploaded',
    "pageCount" INTEGER,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StudyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPage" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "characterCount" INTEGER NOT NULL,
    "tokenEstimate" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunkEmbedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" vector(1536) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DocumentChunkEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTag" (
    "documentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTag_pkey" PRIMARY KEY ("documentId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyDocument_storedFileName_key" ON "StudyDocument"("storedFileName");
CREATE INDEX "StudyDocument_createdAt_idx" ON "StudyDocument"("createdAt");
CREATE INDEX "StudyDocument_uploadStatus_idx" ON "StudyDocument"("uploadStatus");
CREATE INDEX "StudyDocument_className_idx" ON "StudyDocument"("className");
CREATE INDEX "StudyDocument_topic_idx" ON "StudyDocument"("topic");
CREATE INDEX "StudyDocument_source_idx" ON "StudyDocument"("source");
CREATE INDEX "StudyDocument_documentDate_idx" ON "StudyDocument"("documentDate");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPage_documentId_pageNumber_key" ON "DocumentPage"("documentId", "pageNumber");
CREATE INDEX "DocumentPage_documentId_pageNumber_idx" ON "DocumentPage"("documentId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_pageNumber_chunkIndex_key" ON "DocumentChunk"("documentId", "pageNumber", "chunkIndex");
CREATE INDEX "DocumentChunk_documentId_pageNumber_idx" ON "DocumentChunk"("documentId", "pageNumber");
CREATE INDEX "DocumentChunk_text_search_idx" ON "DocumentChunk" USING GIN (to_tsvector('english', "text"));

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunkEmbedding_chunkId_key" ON "DocumentChunkEmbedding"("chunkId");
CREATE INDEX "DocumentChunkEmbedding_embeddingModel_idx" ON "DocumentChunkEmbedding"("embeddingModel");
CREATE INDEX "DocumentChunkEmbedding_dimensions_idx" ON "DocumentChunkEmbedding"("dimensions");
CREATE INDEX "DocumentChunkEmbedding_contentHash_idx" ON "DocumentChunkEmbedding"("contentHash");
CREATE INDEX "DocumentChunkEmbedding_vector_hnsw_idx" ON "DocumentChunkEmbedding" USING hnsw ("vector" vector_cosine_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_normalizedName_key" ON "Tag"("normalizedName");
CREATE INDEX "Tag_name_idx" ON "Tag"("name");
CREATE INDEX "DocumentTag_tagId_idx" ON "DocumentTag"("tagId");

-- AddForeignKey
ALTER TABLE "DocumentPage"
ADD CONSTRAINT "DocumentPage_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "StudyDocument"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk"
ADD CONSTRAINT "DocumentChunk_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "StudyDocument"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunkEmbedding"
ADD CONSTRAINT "DocumentChunkEmbedding_chunkId_fkey"
FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTag"
ADD CONSTRAINT "DocumentTag_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "StudyDocument"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTag"
ADD CONSTRAINT "DocumentTag_tagId_fkey"
FOREIGN KEY ("tagId") REFERENCES "Tag"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
