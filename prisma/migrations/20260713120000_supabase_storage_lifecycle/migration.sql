-- Durable PDF source storage and document lifecycle state.
-- This migration is append-only and preserves existing rows.

ALTER TABLE "StudyDocument"
ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN "storageBucket" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN "storageObjectKey" TEXT,
ADD COLUMN "contentSha256" VARCHAR(64),
ADD COLUMN "failureStage" TEXT,
ADD COLUMN "storageConfirmedAt" TIMESTAMPTZ(6),
ADD COLUMN "processingStartedAt" TIMESTAMPTZ(6),
ADD COLUMN "processingCompletedAt" TIMESTAMPTZ(6),
ADD COLUMN "failedAt" TIMESTAMPTZ(6),
ADD COLUMN "deleteRequestedAt" TIMESTAMPTZ(6),
ADD COLUMN "processingAttemptCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "StudyDocument"
SET "storageObjectKey" = "storedFileName"
WHERE "storageObjectKey" IS NULL;

ALTER TABLE "StudyDocument"
ALTER COLUMN "storageObjectKey" SET NOT NULL;

UPDATE "StudyDocument" AS document
SET "uploadStatus" = CASE LOWER(document."uploadStatus")
    WHEN 'ready' THEN 'READY'
    WHEN 'processing' THEN 'PROCESSING'
    WHEN 'failed' THEN 'FAILED'
    WHEN 'deleting' THEN 'DELETING'
    WHEN 'uploading' THEN 'UPLOADING'
    WHEN 'uploaded' THEN CASE
      WHEN document."pageCount" IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM "DocumentChunk" AS chunk
          WHERE chunk."documentId" = document."id"
        )
        THEN 'READY'
      ELSE 'UPLOADING'
    END
    ELSE 'FAILED'
  END;

ALTER TABLE "StudyDocument"
ALTER COLUMN "uploadStatus" SET DEFAULT 'UPLOADING';

CREATE UNIQUE INDEX "StudyDocument_storageProvider_storageBucket_storageObjectKey_key"
ON "StudyDocument"("storageProvider", "storageBucket", "storageObjectKey");

CREATE INDEX "StudyDocument_storageProvider_idx" ON "StudyDocument"("storageProvider");
CREATE INDEX "StudyDocument_storageBucket_idx" ON "StudyDocument"("storageBucket");
CREATE INDEX "StudyDocument_storageObjectKey_idx" ON "StudyDocument"("storageObjectKey");
CREATE INDEX "StudyDocument_contentSha256_idx" ON "StudyDocument"("contentSha256");
CREATE INDEX "StudyDocument_failureStage_idx" ON "StudyDocument"("failureStage");
