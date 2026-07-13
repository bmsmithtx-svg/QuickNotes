-- CreateTable
CREATE TABLE "StudyDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "className" TEXT,
    "topic" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "uploadStatus" TEXT NOT NULL DEFAULT 'uploaded',
    "pageCount" INTEGER,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DocumentPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudyDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "characterCount" INTEGER NOT NULL,
    "tokenEstimate" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudyDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyDocument_storedFileName_key" ON "StudyDocument"("storedFileName");

-- CreateIndex
CREATE INDEX "StudyDocument_createdAt_idx" ON "StudyDocument"("createdAt");

-- CreateIndex
CREATE INDEX "StudyDocument_uploadStatus_idx" ON "StudyDocument"("uploadStatus");

-- CreateIndex
CREATE INDEX "DocumentPage_documentId_pageNumber_idx" ON "DocumentPage"("documentId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPage_documentId_pageNumber_key" ON "DocumentPage"("documentId", "pageNumber");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_pageNumber_idx" ON "DocumentChunk"("documentId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_pageNumber_chunkIndex_key" ON "DocumentChunk"("documentId", "pageNumber", "chunkIndex");
