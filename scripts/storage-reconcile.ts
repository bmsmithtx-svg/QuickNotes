import { DOCUMENT_UPLOAD_STATUS, toDocumentUploadStatus } from "../src/lib/server/document-lifecycle";
import { getPrisma } from "../src/lib/server/db";
import {
  DOCUMENT_SOURCE_PREFIX,
  getDocumentStorage,
  getDocumentStorageForRecord,
  sha256Hex
} from "../src/lib/server/storage";
import { loadScriptEnv, requireDatabaseScriptConfig } from "./script-env";

type StorageDocument = {
  id: string;
  fileSize: number;
  uploadStatus: string;
  storageProvider: string;
  storageBucket: string;
  storageObjectKey: string;
  contentSha256: string | null;
  failureStage: string | null;
  failureReason: string | null;
  updatedAt: Date;
};

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Storage reconciliation failed.");
  process.exitCode = 1;
});

async function main() {
  requireDatabaseScriptConfig();

  if (process.argv.includes("--delete-orphans")) {
    throw new Error("Destructive storage cleanup is not implemented. Reconciliation is report-only.");
  }

  const verifyChecksums = process.argv.includes("--verify-checksums");
  const prisma = await getPrisma();
  const currentStorage = getDocumentStorage();
  const documents = (await prisma.studyDocument.findMany({
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      fileSize: true,
      uploadStatus: true,
      storageProvider: true,
      storageBucket: true,
      storageObjectKey: true,
      contentSha256: true,
      failureStage: true,
      failureReason: true,
      updatedAt: true
    }
  })) as StorageDocument[];
  const documentKeys = new Set(
    documents
      .filter((document) => document.storageProvider === currentStorage.provider && document.storageBucket === currentStorage.bucket)
      .map((document) => document.storageObjectKey)
  );
  const report = {
    provider: currentStorage.provider,
    bucket: currentStorage.bucket,
    documentCount: documents.length,
    missingStorageObjects: [] as string[],
    orphanStorageObjects: [] as string[],
    stuckDocuments: [] as Array<{ documentId: string; status: string; updatedAt: string }>,
    retryEligibleFailedDocuments: [] as string[],
    metadataInconsistencies: [] as Array<{ documentId: string; issue: string }>,
    checksumMismatches: [] as string[],
    fileSizeMismatches: [] as string[]
  };

  for (const document of documents) {
    const status = toDocumentUploadStatus(document.uploadStatus);

    if (
      status === DOCUMENT_UPLOAD_STATUS.UPLOADING ||
      status === DOCUMENT_UPLOAD_STATUS.PROCESSING ||
      status === DOCUMENT_UPLOAD_STATUS.DELETING
    ) {
      report.stuckDocuments.push({
        documentId: document.id,
        status,
        updatedAt: document.updatedAt.toISOString()
      });
    }

    if (!document.storageObjectKey) {
      report.metadataInconsistencies.push({
        documentId: document.id,
        issue: "missing_storage_object_key"
      });
      continue;
    }

    const storage = getDocumentStorageForRecord(document);
    const exists = await storage.exists(document.storageObjectKey);

    if (!exists) {
      report.missingStorageObjects.push(document.id);
      continue;
    }

    if (status === DOCUMENT_UPLOAD_STATUS.FAILED) {
      report.retryEligibleFailedDocuments.push(document.id);
    }

    if (verifyChecksums && document.contentSha256) {
      const buffer = await storage.readPdf(document.storageObjectKey);

      if (buffer.byteLength !== document.fileSize) {
        report.fileSizeMismatches.push(document.id);
      }

      if (sha256Hex(buffer) !== document.contentSha256) {
        report.checksumMismatches.push(document.id);
      }
    }
  }

  const objects = await currentStorage.listObjects({
    prefix: DOCUMENT_SOURCE_PREFIX,
    limit: 5000
  });

  for (const object of objects) {
    if (!documentKeys.has(object.key)) {
      report.orphanStorageObjects.push(object.key);
    }
  }

  await prisma.$disconnect?.();

  console.log(
    JSON.stringify(
      {
        ok:
          report.missingStorageObjects.length === 0 &&
          report.metadataInconsistencies.length === 0 &&
          report.checksumMismatches.length === 0 &&
          report.fileSizeMismatches.length === 0,
        reportOnly: true,
        verifyChecksums,
        ...report
      },
      null,
      2
    )
  );
}
