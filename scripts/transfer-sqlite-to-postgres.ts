import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { loadScriptEnv, requireDatabaseScriptConfig } from "./script-env";
import { DOCUMENT_UPLOAD_STATUS, toDocumentUploadStatus } from "../src/lib/server/document-lifecycle";
import { getPrisma } from "../src/lib/server/db";
import { serializeVectorForPgvector } from "../src/lib/server/vector-utils";

const PGVECTOR_DIMENSIONS = 1536;

type TransferOptions = {
  apply: boolean;
  source: string;
  includeEmbeddings: boolean;
};

type StudyDocumentRow = {
  id: string;
  originalFileName: string;
  storedFileName: string;
  fileSize: number;
  mimeType: string;
  title: string;
  className: string | null;
  topic: string | null;
  source: string | null;
  documentDate: string | null;
  tags: string;
  uploadStatus: string;
  pageCount: number | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type DocumentPageRow = {
  id: string;
  documentId: string;
  pageNumber: number;
  text: string;
  createdAt: string;
};

type DocumentChunkRow = {
  id: string;
  documentId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  characterCount: number;
  tokenEstimate: number;
  createdAt: string;
};

type TagRow = {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
};

type DocumentTagRow = {
  documentId: string;
  tagId: string;
  createdAt: string;
};

type EmbeddingRow = {
  id: string;
  chunkId: string;
  embeddingModel: string;
  dimensions: number;
  vectorJson: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
};

type CountRow = {
  tableName: string;
  rowCount: number;
};

type CreateManyDelegate = {
  createMany: (args: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count?: number }>;
};

type TransferPrisma = {
  studyDocument: CreateManyDelegate;
  documentPage: CreateManyDelegate;
  documentChunk: CreateManyDelegate;
  tag: CreateManyDelegate;
  documentTag: CreateManyDelegate;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $disconnect?: () => Promise<void>;
};

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "SQLite transfer failed.");
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const source = resolve(options.source);

  if (!existsSync(source)) {
    throw new Error(`SQLite source database not found: ${source}`);
  }

  const counts = readCounts(source);
  const summary = {
    mode: options.apply ? "apply" : "dry-run",
    source,
    counts,
    includeEmbeddings: options.includeEmbeddings,
    note:
      "This procedure copies database rows only. It does not upload local PDF files or delete existing PostgreSQL/Supabase rows."
  };

  if (!options.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  requireDatabaseScriptConfig();

  const prisma = (await getPrisma()) as unknown as TransferPrisma;

  try {
    const result = await transferRows(prisma, source, options);

    console.log(
      JSON.stringify(
        {
          ...summary,
          transferred: result
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect?.();
  }
}

async function transferRows(prisma: TransferPrisma, source: string, options: TransferOptions) {
  const documents = readRows<StudyDocumentRow>(
    source,
    `SELECT id, originalFileName, storedFileName, fileSize, mimeType, title, className, topic, source, documentDate, tags, uploadStatus, pageCount, failureReason, createdAt, updatedAt FROM StudyDocument ORDER BY id`
  );
  const pages = readRows<DocumentPageRow>(
    source,
    `SELECT id, documentId, pageNumber, text, createdAt FROM DocumentPage ORDER BY documentId, pageNumber`
  );
  const chunks = readRows<DocumentChunkRow>(
    source,
    `SELECT id, documentId, pageNumber, chunkIndex, text, characterCount, tokenEstimate, createdAt FROM DocumentChunk ORDER BY documentId, pageNumber, chunkIndex`
  );
  const tags = readRows<TagRow>(
    source,
    `SELECT id, name, normalizedName, createdAt, updatedAt FROM Tag ORDER BY normalizedName`
  );
  const documentTags = readRows<DocumentTagRow>(
    source,
    `SELECT documentId, tagId, createdAt FROM DocumentTag ORDER BY documentId, tagId`
  );

  const insertedDocuments = await prisma.studyDocument.createMany({
    data: documents.map((row) => ({
      id: row.id,
      originalFileName: row.originalFileName,
      storedFileName: row.storedFileName,
      fileSize: Number(row.fileSize),
      mimeType: row.mimeType,
      storageProvider: "local",
      storageBucket: "local",
      storageObjectKey: row.storedFileName,
      title: row.title,
      className: row.className,
      topic: row.topic,
      source: row.source,
      documentDate: parseOptionalDate(row.documentDate, true),
      tags: row.tags,
      uploadStatus:
        row.uploadStatus === "uploaded" && row.pageCount !== null
          ? DOCUMENT_UPLOAD_STATUS.READY
          : toDocumentUploadStatus(row.uploadStatus),
      pageCount: row.pageCount === null ? null : Number(row.pageCount),
      failureReason: row.failureReason,
      createdAt: parseRequiredDate(row.createdAt),
      updatedAt: parseRequiredDate(row.updatedAt)
    })),
    skipDuplicates: true
  });
  const insertedPages = await prisma.documentPage.createMany({
    data: pages.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      pageNumber: Number(row.pageNumber),
      text: row.text,
      createdAt: parseRequiredDate(row.createdAt)
    })),
    skipDuplicates: true
  });
  const insertedChunks = await prisma.documentChunk.createMany({
    data: chunks.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      pageNumber: Number(row.pageNumber),
      chunkIndex: Number(row.chunkIndex),
      text: row.text,
      characterCount: Number(row.characterCount),
      tokenEstimate: Number(row.tokenEstimate),
      createdAt: parseRequiredDate(row.createdAt)
    })),
    skipDuplicates: true
  });
  const insertedTags = await prisma.tag.createMany({
    data: tags.map((row) => ({
      id: row.id,
      name: row.name,
      normalizedName: row.normalizedName,
      createdAt: parseRequiredDate(row.createdAt),
      updatedAt: parseRequiredDate(row.updatedAt)
    })),
    skipDuplicates: true
  });
  const insertedDocumentTags = await prisma.documentTag.createMany({
    data: documentTags.map((row) => ({
      documentId: row.documentId,
      tagId: row.tagId,
      createdAt: parseRequiredDate(row.createdAt)
    })),
    skipDuplicates: true
  });
  const embeddingResult = options.includeEmbeddings
    ? await transferEmbeddings(prisma, source)
    : { inserted: 0, skippedIncompatible: 0 };

  return {
    documents: insertedDocuments.count ?? 0,
    pages: insertedPages.count ?? 0,
    chunks: insertedChunks.count ?? 0,
    tags: insertedTags.count ?? 0,
    documentTags: insertedDocumentTags.count ?? 0,
    embeddings: embeddingResult.inserted,
    skippedIncompatibleEmbeddings: embeddingResult.skippedIncompatible
  };
}

async function transferEmbeddings(prisma: TransferPrisma, source: string) {
  const rows = readRows<EmbeddingRow>(
    source,
    `SELECT id, chunkId, embeddingModel, dimensions, vectorJson, contentHash, createdAt, updatedAt FROM DocumentChunkEmbedding ORDER BY chunkId`
  );
  let inserted = 0;
  let skippedIncompatible = 0;

  for (const row of rows) {
    const vector = parseCompatibleVector(row);

    if (!vector) {
      skippedIncompatible += 1;
      continue;
    }

    inserted += await prisma.$executeRawUnsafe(
      `
        INSERT INTO "DocumentChunkEmbedding" (
          "id",
          "chunkId",
          "embeddingModel",
          "dimensions",
          "vector",
          "contentHash",
          "createdAt",
          "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8)
        ON CONFLICT DO NOTHING
      `,
      row.id,
      row.chunkId,
      row.embeddingModel,
      PGVECTOR_DIMENSIONS,
      serializeVectorForPgvector(vector, PGVECTOR_DIMENSIONS),
      row.contentHash,
      parseRequiredDate(row.createdAt),
      parseRequiredDate(row.updatedAt)
    );
  }

  return {
    inserted,
    skippedIncompatible
  };
}

function readCounts(source: string) {
  return readRows<CountRow>(
    source,
    `
      SELECT 'StudyDocument' AS tableName, COUNT(*) AS rowCount FROM StudyDocument
      UNION ALL SELECT 'DocumentPage', COUNT(*) FROM DocumentPage
      UNION ALL SELECT 'DocumentChunk', COUNT(*) FROM DocumentChunk
      UNION ALL SELECT 'DocumentChunkEmbedding', COUNT(*) FROM DocumentChunkEmbedding
      UNION ALL SELECT 'Tag', COUNT(*) FROM Tag
      UNION ALL SELECT 'DocumentTag', COUNT(*) FROM DocumentTag
    `
  );
}

function readRows<Row>(source: string, query: string) {
  const output = execFileSync("sqlite3", ["-json", source, query], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  }).trim();

  if (!output) {
    return [] as Row[];
  }

  return JSON.parse(output) as Row[];
}

function parseCompatibleVector(row: EmbeddingRow) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(row.vectorJson);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || Number(row.dimensions) !== PGVECTOR_DIMENSIONS || parsed.length !== PGVECTOR_DIMENSIONS) {
    return null;
  }

  const vector = parsed.map((value) => (typeof value === "number" ? value : Number.NaN));

  return vector.every(Number.isFinite) ? vector : null;
}

function parseRequiredDate(value: string) {
  const date = parseOptionalDate(value, false);

  if (!date) {
    throw new Error(`Invalid SQLite timestamp: ${value}`);
  }

  return date;
}

function parseOptionalDate(value: string | null, dateOnly: boolean) {
  if (!value) {
    return null;
  }

  const normalized = dateOnly ? value.slice(0, 10) : value.replace(" ", "T");
  const date = new Date(dateOnly ? `${normalized}T00:00:00.000Z` : normalized.endsWith("Z") ? normalized : `${normalized}Z`);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date;
}

function parseOptions(args: string[]): TransferOptions {
  const options: TransferOptions = {
    apply: false,
    source: "prisma/quicknotes.dev.db",
    includeEmbeddings: true
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--source") {
      const source = args[index + 1]?.trim();

      if (!source) {
        throw new Error("--source requires a SQLite database path.");
      }

      options.source = source;
      index += 1;
    } else if (arg === "--skip-embeddings") {
      options.includeEmbeddings = false;
    } else if (arg === "--dry-run") {
      options.apply = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}
