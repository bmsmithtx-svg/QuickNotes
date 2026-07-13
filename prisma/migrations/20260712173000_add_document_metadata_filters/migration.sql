-- Add metadata fields used for filtered retrieval.
ALTER TABLE "StudyDocument" ADD COLUMN "source" TEXT;
ALTER TABLE "StudyDocument" ADD COLUMN "documentDate" DATETIME;

-- Normalized tags. StudyDocument.tags remains as a legacy JSON cache for older rows,
-- but filtering and metadata management use Tag/DocumentTag.
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "DocumentTag" (
    "documentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("documentId", "tagId"),
    CONSTRAINT "DocumentTag_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudyDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Tag_normalizedName_key" ON "Tag"("normalizedName");
CREATE INDEX "Tag_name_idx" ON "Tag"("name");
CREATE INDEX "DocumentTag_tagId_idx" ON "DocumentTag"("tagId");

INSERT OR IGNORE INTO "Tag" ("id", "name", "normalizedName", "createdAt", "updatedAt")
SELECT
    lower(hex(randomblob(16))),
    "tagName",
    lower("tagName"),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT trim("tagValue"."value") AS "tagName"
    FROM "StudyDocument" AS "document",
    json_each(CASE WHEN json_valid("document"."tags") THEN "document"."tags" ELSE '[]' END) AS "tagValue"
    WHERE "tagValue"."type" = 'text'
      AND trim("tagValue"."value") <> ''
);

INSERT OR IGNORE INTO "DocumentTag" ("documentId", "tagId", "createdAt")
SELECT
    "document"."id",
    "tag"."id",
    CURRENT_TIMESTAMP
FROM "StudyDocument" AS "document",
json_each(CASE WHEN json_valid("document"."tags") THEN "document"."tags" ELSE '[]' END) AS "tagValue"
INNER JOIN "Tag" AS "tag"
    ON "tag"."normalizedName" = lower(trim("tagValue"."value"))
WHERE "tagValue"."type" = 'text'
  AND trim("tagValue"."value") <> '';

CREATE INDEX "StudyDocument_className_idx" ON "StudyDocument"("className");
CREATE INDEX "StudyDocument_topic_idx" ON "StudyDocument"("topic");
CREATE INDEX "StudyDocument_source_idx" ON "StudyDocument"("source");
CREATE INDEX "StudyDocument_documentDate_idx" ON "StudyDocument"("documentDate");
