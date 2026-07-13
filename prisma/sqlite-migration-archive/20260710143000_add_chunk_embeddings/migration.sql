-- Store one local embedding vector per document chunk.
-- Vectors are serialized as JSON so SQLite can persist them without a hosted vector database.
CREATE TABLE "DocumentChunkEmbedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chunkId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vectorJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DocumentChunkEmbedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DocumentChunkEmbedding_chunkId_key" ON "DocumentChunkEmbedding"("chunkId");
CREATE INDEX "DocumentChunkEmbedding_embeddingModel_idx" ON "DocumentChunkEmbedding"("embeddingModel");
CREATE INDEX "DocumentChunkEmbedding_contentHash_idx" ON "DocumentChunkEmbedding"("contentHash");
