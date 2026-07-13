-- Local retrieval index for keyword search over ingested chunks.
-- DocumentChunk remains the source of truth; this FTS table is rebuilt/synced from it.
CREATE VIRTUAL TABLE IF NOT EXISTS "DocumentChunkSearch" USING fts5(
    "chunkId" UNINDEXED,
    "documentId" UNINDEXED,
    "text",
    tokenize = 'unicode61'
);

INSERT INTO "DocumentChunkSearch" ("chunkId", "documentId", "text")
SELECT "id", "documentId", "text"
FROM "DocumentChunk"
WHERE NOT EXISTS (
    SELECT 1
    FROM "DocumentChunkSearch"
    WHERE "DocumentChunkSearch"."chunkId" = "DocumentChunk"."id"
);
