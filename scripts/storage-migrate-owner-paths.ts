import { DOCUMENT_UPLOAD_STATUS, toDocumentUploadStatus } from "../src/lib/server/document-lifecycle";
import { getPrisma } from "../src/lib/server/db";
import {
  createDocumentStorage,
  createPdfObjectKey,
  getDocumentStorageForRecord,
  getSupabaseStorageConfig,
  isOwnerScopedPdfObjectKey,
  sha256Hex
} from "../src/lib/server/storage";
import { loadScriptEnv, requireDatabaseScriptConfig } from "./script-env";

type OwnedStorageDocument = {
  id: string;
  ownerId: string;
  fileSize: number;
  mimeType: string;
  storageProvider: string;
  storageBucket: string;
  storageObjectKey: string;
  contentSha256: string | null;
  uploadStatus: string;
};

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Owner-scoped storage migration failed.");
  process.exitCode = 1;
});

async function main() {
  requireDatabaseScriptConfig();

  const deleteLegacySource = process.argv.includes("--delete-legacy-source");
  const prisma = await getPrisma();
  const targetStorage = createDocumentStorage(getSupabaseStorageConfig());
  const documents = (await prisma.studyDocument.findMany({
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      ownerId: true,
      fileSize: true,
      mimeType: true,
      storageProvider: true,
      storageBucket: true,
      storageObjectKey: true,
      contentSha256: true,
      uploadStatus: true
    }
  })) as OwnedStorageDocument[];
  const summary = {
    scanned: documents.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
    deletedLegacyObjects: 0,
    details: [] as Array<{
      documentId: string;
      status: "migrated" | "skipped" | "failed";
      reason?: string;
      oldKey?: string;
      newKey?: string;
    }>
  };

  for (const document of documents) {
    const status = toDocumentUploadStatus(document.uploadStatus);

    if (status === DOCUMENT_UPLOAD_STATUS.DELETING) {
      summary.skipped += 1;
      summary.details.push({
        documentId: document.id,
        status: "skipped",
        reason: "deletion_in_progress"
      });
      continue;
    }

    const nextKey = createPdfObjectKey(document.ownerId, document.id);

    if (
      document.storageProvider === targetStorage.provider &&
      document.storageBucket === targetStorage.bucket &&
      isOwnerScopedPdfObjectKey(document.storageObjectKey, document.ownerId, document.id)
    ) {
      summary.skipped += 1;
      summary.details.push({
        documentId: document.id,
        status: "skipped",
        reason: "already_owner_scoped",
        newKey: nextKey
      });
      continue;
    }

    try {
      const sourceStorage = getDocumentStorageForRecord(document);
      const buffer = await sourceStorage.readPdf(document.storageObjectKey);
      const checksum = sha256Hex(buffer);

      if (document.contentSha256 && document.contentSha256 !== checksum) {
        throw new Error("source checksum does not match document record");
      }

      if (!(await targetStorage.exists(nextKey))) {
        await targetStorage.uploadPdf({
          key: nextKey,
          body: buffer,
          contentType: document.mimeType || "application/pdf",
          contentSha256: checksum
        });
      }

      if (!(await targetStorage.exists(nextKey))) {
        throw new Error("owner-scoped object could not be verified after upload");
      }

      await prisma.studyDocument.update({
        where: {
          id: document.id
        },
        data: {
          storedFileName: nextKey,
          storageProvider: targetStorage.provider,
          storageBucket: targetStorage.bucket,
          storageObjectKey: nextKey,
          contentSha256: checksum,
          storageConfirmedAt: new Date()
        }
      });

      if (deleteLegacySource && document.storageObjectKey !== nextKey) {
        const deleted = await sourceStorage.deleteObject(document.storageObjectKey);

        if (deleted.deleted) {
          summary.deletedLegacyObjects += 1;
        }
      }

      summary.migrated += 1;
      summary.details.push({
        documentId: document.id,
        status: "migrated",
        oldKey: document.storageObjectKey,
        newKey: nextKey
      });
    } catch (error) {
      summary.failed += 1;
      summary.details.push({
        documentId: document.id,
        status: "failed",
        oldKey: document.storageObjectKey,
        newKey: nextKey,
        reason: error instanceof Error ? error.message : "migration failed"
      });
    }
  }

  await prisma.$disconnect?.();

  console.log(
    JSON.stringify(
      {
        ok: summary.failed === 0,
        deleteLegacySource,
        ...summary
      },
      null,
      2
    )
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}
