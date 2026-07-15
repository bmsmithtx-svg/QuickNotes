import { getPrisma } from "../src/lib/server/db";
import {
  createDocumentStorage,
  getStorageConfig,
  getSupabaseStorageConfig,
  sha256Hex
} from "../src/lib/server/storage";
import { loadScriptEnv, requireDatabaseScriptConfig } from "./script-env";

type LegacyDocument = {
  id: string;
  storedFileName: string;
  mimeType: string;
  storageProvider: string;
  storageObjectKey: string;
  contentSha256: string | null;
};

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local storage migration failed.");
  process.exitCode = 1;
});

async function main() {
  requireDatabaseScriptConfig();

  const prisma = await getPrisma();
  const localConfig = getStorageConfig({
    ...process.env,
    QUICKNOTES_STORAGE_PROVIDER: "local"
  });

  if (localConfig.provider !== "local") {
    throw new Error("Local storage configuration could not be loaded.");
  }

  const localStorage = createDocumentStorage(localConfig);
  const supabaseStorage = createDocumentStorage(getSupabaseStorageConfig());
  const documents = (await prisma.studyDocument.findMany({
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      storedFileName: true,
      mimeType: true,
      storageProvider: true,
      storageObjectKey: true,
      contentSha256: true
    }
  })) as LegacyDocument[];
  const summary = {
    scanned: documents.length,
    migrated: 0,
    skipped: 0,
    missing: 0,
    failed: 0,
    details: [] as Array<{
      documentId: string;
      status: "migrated" | "skipped" | "missing" | "failed";
      reason?: string;
      objectKey?: string;
    }>
  };

  for (const document of documents) {
    if (document.storageProvider === "supabase") {
      summary.skipped += 1;
      summary.details.push({
        documentId: document.id,
        status: "skipped",
        reason: "already_supabase",
        objectKey: document.storageObjectKey
      });
      continue;
    }

    const localKey = document.storageObjectKey || document.storedFileName;

    if (!(await localStorage.exists(localKey))) {
      summary.missing += 1;
      summary.details.push({
        documentId: document.id,
        status: "missing",
        reason: `local source not found: ${localKey}`
      });
      continue;
    }

    try {
      const buffer = await localStorage.readPdf(localKey);
      const checksum = sha256Hex(buffer);
      const objectKey = createMigratedObjectKey(document.id, checksum);

      if (!(await supabaseStorage.exists(objectKey))) {
        await supabaseStorage.uploadPdf({
          key: objectKey,
          body: buffer,
          contentType: document.mimeType || "application/pdf",
          contentSha256: checksum
        });
      }

      if (!(await supabaseStorage.exists(objectKey))) {
        throw new Error("uploaded object could not be verified");
      }

      await prisma.studyDocument.update({
        where: {
          id: document.id
        },
        data: {
          storedFileName: objectKey,
          storageProvider: "supabase",
          storageBucket: supabaseStorage.bucket,
          storageObjectKey: objectKey,
          contentSha256: checksum,
          storageConfirmedAt: new Date()
        }
      });

      summary.migrated += 1;
      summary.details.push({
        documentId: document.id,
        status: "migrated",
        objectKey
      });
    } catch (error) {
      summary.failed += 1;
      summary.details.push({
        documentId: document.id,
        status: "failed",
        reason: error instanceof Error ? error.message : "migration failed"
      });
    }
  }

  await prisma.$disconnect?.();

  console.log(
    JSON.stringify(
      {
        ok: summary.failed === 0,
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

function createMigratedObjectKey(documentId: string, checksum: string) {
  return `documents/${documentId}-${checksum.slice(0, 32)}.pdf`;
}
