import { loadScriptEnv, requireDatabaseScriptConfig } from "./script-env";
import { validateProductionEnvironment } from "../src/lib/server/env-validation";
import { getPrisma, type PrismaClientLike } from "../src/lib/server/db";
import { getEmbeddingRuntimeConfig } from "../src/lib/server/embedding-config";
import { deleteStoredDocument, DOCUMENT_UPLOAD_STATUS } from "../src/lib/server/document-lifecycle";
import { getDocumentStorageForRecord, ensureConfiguredStorage } from "../src/lib/server/storage";

type JsonObject = Record<string, unknown>;

type SmokeDocumentRecord = {
  id: string;
  originalFileName: string;
  mimeType: string;
  uploadStatus: string;
  storageProvider: string;
  storageBucket: string;
  storageObjectKey: string;
  storageConfirmedAt: Date | string | null;
  processingCompletedAt: Date | string | null;
};

type EmbeddingCountRow = {
  chunkCount: number | bigint;
  embeddingCount: number | bigint;
};

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Production smoke test failed.");
  process.exitCode = 1;
});

async function main() {
  requireDatabaseScriptConfig();
  validateProductionEnvironment();
  const storageCheck = await ensureConfiguredStorage();

  if (storageCheck.provider !== "supabase") {
    throw new Error("Production smoke requires QUICKNOTES_STORAGE_PROVIDER=supabase.");
  }

  const prisma = await getPrisma();
  let documentId: string | null = null;
  let deleted = false;

  try {
    await assertDatabaseConnectivity(prisma);

    const uploadRoute = await import("../src/app/api/documents/upload/route");
    const sourceRoute = await import("../src/app/api/documents/[id]/source/route");
    const searchRoute = await import("../src/app/api/search/route");
    const answerRoute = await import("../src/app/api/answer/route");
    const documentRoute = await import("../src/app/api/documents/[id]/route");

    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const title = `QuickNotes Production Smoke ${stamp}`;
    const upload = await jsonResponse(
      await uploadRoute.POST(
        new Request("http://quicknotes.local/api/documents/upload", {
          method: "POST",
          body: createSmokeFormData(stamp, title)
        })
      )
    );

    assertStatus(upload, 201, "upload");
    documentId = getString(upload.body, "documentId");
    assertEqual(getString(upload.body, "status"), DOCUMENT_UPLOAD_STATUS.READY, "upload status");
    assertEqual(getString(upload.body, "embeddingStatus"), "complete", "upload embedding status");

    const document = await getSmokeDocument(prisma, documentId);

    assertEqual(document.uploadStatus, DOCUMENT_UPLOAD_STATUS.READY, "persisted upload status");
    assertEqual(document.storageProvider, "supabase", "persisted storage provider");
    assertTruthy(document.storageConfirmedAt, "storage confirmation timestamp");
    assertTruthy(document.processingCompletedAt, "processing completion timestamp");

    const storage = getDocumentStorageForRecord(document);

    if (!(await storage.exists(document.storageObjectKey))) {
      throw new Error("Stored smoke PDF object does not exist.");
    }

    const source = await sourceRoute.GET(new Request(`http://quicknotes.local/api/documents/${documentId}/source`), {
      params: Promise.resolve({
        id: documentId
      })
    });
    const signedLocation = source.headers.get("location");

    if (source.status < 300 || source.status >= 400 || !signedLocation) {
      throw new Error(`source PDF route did not return a signed redirect; HTTP ${source.status}.`);
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

    if (signedLocation.includes("service_role") || (serviceRoleKey && signedLocation.includes(serviceRoleKey))) {
      throw new Error("Signed source URL appears to expose service-role material.");
    }

    const embeddingCounts = await getDocumentEmbeddingCounts(prisma, documentId);

    if (embeddingCounts.chunkCount === 0 || embeddingCounts.embeddingCount !== embeddingCounts.chunkCount) {
      throw new Error(
        `Expected one fresh embedding per persisted chunk; found ${embeddingCounts.embeddingCount}/${embeddingCounts.chunkCount}.`
      );
    }

    const filterParams = new URLSearchParams({
      documentId,
      className: "Production Smoke",
      topic: "Persistence",
      source: "QuickNotes production smoke",
      tag: "production-smoke",
      dateFrom: "2026-07-15",
      dateTo: "2026-07-15"
    });
    const keyword = await searchAndAssert(searchRoute, "keyword", filterParams, documentId);
    const semantic = await searchAndAssert(searchRoute, "semantic", filterParams, documentId);
    const hybrid = await searchAndAssert(searchRoute, "hybrid", filterParams, documentId);
    const answer = await answerAndAssert(answerRoute, documentId);
    const deleteResponse = await jsonResponse(
      await documentRoute.DELETE(new Request(`http://quicknotes.local/api/documents/${documentId}`, { method: "DELETE" }), {
        params: Promise.resolve({
          id: documentId
        })
      })
    );

    assertStatus(deleteResponse, 200, "document deletion");
    assertEqual(getString(deleteResponse.body, "status"), "deleted", "delete status");
    deleted = true;

    if (await prisma.studyDocument.findUnique({ where: { id: documentId } })) {
      throw new Error("Smoke document still exists after deletion.");
    }

    if (await storage.exists(document.storageObjectKey)) {
      throw new Error("Smoke PDF object still exists after deletion.");
    }

    const embeddingConfig = getEmbeddingRuntimeConfig();

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: {
            connected: true,
            provider: "supabase-postgresql"
          },
          storage: {
            provider: storageCheck.provider,
            privateBucketVerified: true,
            uploadedObjectVerified: true,
            signedSourceUrlCreated: true
          },
          upload: {
            documentId,
            status: DOCUMENT_UPLOAD_STATUS.READY,
            pageCount: upload.body.pageCount,
            chunkCount: upload.body.chunkCount
          },
          embeddings: {
            model: embeddingConfig.model,
            dimensions: embeddingConfig.dimensions,
            chunkCount: embeddingCounts.chunkCount,
            embeddingCount: embeddingCounts.embeddingCount
          },
          retrieval: {
            keyword,
            semantic,
            hybrid
          },
          answer,
          cleanup: {
            documentDeleted: true,
            storageObjectDeleted: true
          }
        },
        null,
        2
      )
    );
  } finally {
    if (documentId && !deleted) {
      await cleanupSmokeDocument(prisma, documentId);
    }

    await prisma.$disconnect?.();
  }
}

async function assertDatabaseConnectivity(prisma: PrismaClientLike) {
  const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>("SELECT 1 AS ok");

  if (rows[0]?.ok !== 1) {
    throw new Error("Database connectivity check failed.");
  }
}

async function getSmokeDocument(prisma: PrismaClientLike, documentId: string) {
  const document = (await prisma.studyDocument.findUnique({
    where: {
      id: documentId
    },
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      uploadStatus: true,
      storageProvider: true,
      storageBucket: true,
      storageObjectKey: true,
      storageConfirmedAt: true,
      processingCompletedAt: true
    }
  })) as SmokeDocumentRecord | null;

  if (!document) {
    throw new Error(`Smoke document ${documentId} was not persisted.`);
  }

  return document;
}

async function getDocumentEmbeddingCounts(prisma: PrismaClientLike, documentId: string) {
  const config = getEmbeddingRuntimeConfig();
  const rows = await prisma.$queryRawUnsafe<EmbeddingCountRow[]>(
    `
      SELECT
        COUNT(chunk."id") AS "chunkCount",
        COUNT(embedding."id") AS "embeddingCount"
      FROM "DocumentChunk" AS chunk
      LEFT JOIN "DocumentChunkEmbedding" AS embedding
        ON embedding."chunkId" = chunk."id"
        AND embedding."embeddingModel" = $2
        AND embedding."dimensions" = $3
      WHERE chunk."documentId" = $1
    `,
    documentId,
    config.model,
    config.dimensions
  );
  const row = rows[0] ?? {
    chunkCount: 0,
    embeddingCount: 0
  };

  return {
    chunkCount: Number(row.chunkCount),
    embeddingCount: Number(row.embeddingCount)
  };
}

async function searchAndAssert(
  searchRoute: typeof import("../src/app/api/search/route"),
  mode: "keyword" | "semantic" | "hybrid",
  filters: URLSearchParams,
  documentId: string
) {
  const response = await jsonResponse(
    await searchRoute.GET(new Request(`http://quicknotes.local/api/search?q=mitochondria%20ATP&mode=${mode}&${filters}`))
  );

  assertStatus(response, 200, `${mode} search`);
  assertSearchContainsDocument(response.body, documentId);

  return {
    status: response.status,
    resultCount: getNumber(response.body, "resultCount")
  };
}

async function answerAndAssert(answerRoute: typeof import("../src/app/api/answer/route"), documentId: string) {
  const response = await jsonResponse(
    await answerRoute.POST(
      new Request("http://quicknotes.local/api/answer", {
        method: "POST",
        body: JSON.stringify({
          question: "What does the production smoke document say mitochondria make?",
          mode: "hybrid",
          topK: 5,
          filters: {
            documentIds: [documentId],
            classNames: ["Production Smoke"],
            topics: ["Persistence"],
            sources: ["QuickNotes production smoke"],
            tags: ["production-smoke"],
            documentDateFrom: "2026-07-15",
            documentDateTo: "2026-07-15"
          }
        })
      })
    )
  );

  assertStatus(response, 200, "citation-backed answer");
  assertEqual(getString(response.body, "status"), "answered", "answer status");

  const answer = getString(response.body, "answer");
  const citations = response.body.citations;

  if (!Array.isArray(citations) || citations.length === 0) {
    throw new Error("Answer did not return citations.");
  }

  if (!citations.every((citation) => isCitationForDocument(citation, documentId))) {
    throw new Error("Answer returned a citation outside the smoke document filter.");
  }

  if (!citations.some((citation) => String((citation as JsonObject).sourceText ?? "").includes("Mitochondria make ATP"))) {
    throw new Error("Answer citations did not include the persisted smoke source text.");
  }

  const markers = citations.map((citation) => String((citation as JsonObject).marker ?? ""));

  if (!markers.some((marker) => marker && answer.includes(marker))) {
    throw new Error("Answer text did not include a returned citation marker.");
  }

  return {
    status: "answered",
    citationCount: citations.length,
    citationGroundingVerified: true
  };
}

async function cleanupSmokeDocument(prisma: PrismaClientLike, documentId: string) {
  try {
    await deleteStoredDocument({
      prisma,
      documentId
    });
  } catch (error) {
    console.error(
      `Cleanup failed for smoke document ${documentId}: ${
        error instanceof Error ? error.message.replace(/[A-Za-z0-9_-]{48,}/g, "[redacted]") : "unknown error"
      }`
    );
  }
}

async function jsonResponse(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as JsonObject
  };
}

function createSmokeFormData(stamp: string, title: string) {
  const formData = new FormData();

  formData.set(
    "file",
    new File([createSmokePdf()], `quicknotes-production-smoke-${stamp}.pdf`, {
      type: "application/pdf"
    })
  );
  formData.set("title", title);
  formData.set("className", "Production Smoke");
  formData.set("topic", "Persistence");
  formData.set("source", "QuickNotes production smoke");
  formData.set("documentDate", "2026-07-15");
  formData.set("tags", "production-smoke,supabase,vercel");

  return formData;
}

function createSmokePdf() {
  const content = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    `(${escapePdfText("Mitochondria make ATP for production persistence checks.")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("Private Supabase Storage keeps source PDFs durable.")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("Hybrid retrieval should cite this persisted smoke document.")}) Tj`,
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

function escapePdfText(text: string) {
  return text.replace(/([\\()])/g, "\\$1");
}

function assertStatus(response: { status: number; body: JsonObject }, expected: number, label: string) {
  if (response.status !== expected) {
    throw new Error(`${label} returned HTTP ${response.status}: ${JSON.stringify(response.body)}`);
  }
}

function assertSearchContainsDocument(body: JsonObject, documentId: string) {
  const results = body.results;

  if (!Array.isArray(results) || !results.some((result) => isObjectWithString(result, "documentId", documentId))) {
    throw new Error(`Search did not return document ${documentId}.`);
  }
}

function assertEqual(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertTruthy(value: unknown, label: string) {
  if (!value) {
    throw new Error(`${label} is required.`);
  }
}

function getString(body: JsonObject, key: string) {
  const value = body[key];

  if (typeof value !== "string" || !value) {
    throw new Error(`Expected response field ${key} to be a non-empty string.`);
  }

  return value;
}

function getNumber(body: JsonObject, key: string) {
  const value = body[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected response field ${key} to be a number.`);
  }

  return value;
}

function isObjectWithString(value: unknown, key: string, expected: string) {
  return Boolean(value && typeof value === "object" && (value as JsonObject)[key] === expected);
}

function isCitationForDocument(value: unknown, documentId: string) {
  return Boolean(value && typeof value === "object" && (value as JsonObject).documentId === documentId);
}
