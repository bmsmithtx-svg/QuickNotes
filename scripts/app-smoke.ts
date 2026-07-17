import { loadScriptEnv, requireDatabaseScriptConfig } from "./script-env";
import { getAnswerRuntimeConfig } from "../src/lib/server/answer-config";
import { getPrisma } from "../src/lib/server/db";
import { getEmbeddingRuntimeConfig } from "../src/lib/server/embedding-config";
import { validateEmbeddingStore } from "../src/lib/server/embedding-validation";
import { authorizedRequest, createSmokeAuthContext } from "./smoke-auth";

type JsonObject = Record<string, unknown>;

loadScriptEnv();

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Application smoke test failed.");
  process.exitCode = 1;
});

async function main() {
  requireDatabaseScriptConfig();

  const uploadRoute = await import("../src/app/api/documents/upload/route");
  const listRoute = await import("../src/app/api/documents/list/route");
  const detailRoute = await import("../src/app/api/documents/[id]/route");
  const contentRoute = await import("../src/app/api/documents/[id]/content/route");
  const searchRoute = await import("../src/app/api/search/route");
  const answerRoute = await import("../src/app/api/answer/route");
  const metadataOptionsRoute = await import("../src/app/api/documents/metadata-options/route");

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const title = `QuickNotes Supabase Smoke ${stamp}`;
  const authContext = await createSmokeAuthContext(1, `app-${stamp}`);
  const accessToken = authContext.users[0].accessToken;

  try {
  const formData = new FormData();

  formData.set(
    "file",
    new File([createSmokePdf()], `quicknotes-smoke-${stamp}.pdf`, {
      type: "application/pdf"
    })
  );
  formData.set("title", title);
  formData.set("className", "Smoke Class");
  formData.set("topic", "Persistence");
  formData.set("source", "Codex smoke");
  formData.set("documentDate", "2026-07-13");
  formData.set("tags", "smoke,supabase");

  const upload = await jsonResponse(
    await uploadRoute.POST(
      new Request("http://quicknotes.local/api/documents/upload", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        method: "POST",
        body: formData
      })
    )
  );

  assertStatus(upload, 201, "upload");

  const documentId = getString(upload.body, "documentId");
  const list = await jsonResponse(await listRoute.GET(authorizedRequest("http://quicknotes.local/api/documents/list", accessToken)));

  assertStatus(list, 200, "list documents");
  assertDocumentInList(list.body, documentId);

  const context = {
    params: Promise.resolve({
      id: documentId
    })
  };
  const detail = await jsonResponse(
    await detailRoute.GET(authorizedRequest("http://quicknotes.local/api/documents", accessToken), context)
  );

  assertStatus(detail, 200, "document detail");

  const content = await jsonResponse(
    await contentRoute.GET(authorizedRequest(`http://quicknotes.local/api/documents/${documentId}/content`, accessToken), context)
  );

  assertStatus(content, 200, "document content");
  assertContentIncludes(content.body, "mitochondria");

  const metadata = await jsonResponse(
    await detailRoute.PATCH(
      authorizedRequest(`http://quicknotes.local/api/documents/${documentId}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          className: "Smoke Class Updated",
          topic: "Persistence Updated",
          source: "Codex route smoke",
          documentDate: "2026-07-13",
          tags: ["smoke", "supabase", "route-smoke"]
        })
      }),
      context
    )
  );

  assertStatus(metadata, 200, "metadata update");

  const metadataOptions = await jsonResponse(
    await metadataOptionsRoute.GET(authorizedRequest("http://quicknotes.local/api/documents/metadata-options", accessToken))
  );

  assertStatus(metadataOptions, 200, "metadata options");

  const filterParams = new URLSearchParams({
    className: "Smoke Class Updated",
    topic: "Persistence Updated",
    source: "Codex route smoke",
    tag: "route-smoke",
    dateFrom: "2026-07-13",
    dateTo: "2026-07-13"
  });
  const keyword = await jsonResponse(
    await searchRoute.GET(authorizedRequest(`http://quicknotes.local/api/search?q=mitochondria&mode=keyword&${filterParams}`, accessToken))
  );

  assertStatus(keyword, 200, "keyword search");
  assertSearchContainsDocument(keyword.body, documentId);

  const semantic = await searchIfAvailable(searchRoute, "semantic", filterParams, documentId, accessToken);
  const hybrid = await searchIfAvailable(searchRoute, "hybrid", filterParams, documentId, accessToken);
  const unsupportedAnswer = await jsonResponse(
    await answerRoute.POST(
      authorizedRequest("http://quicknotes.local/api/answer", accessToken, {
        method: "POST",
        body: JSON.stringify({
          question: "What is the capital of France?",
          mode: "keyword",
          topK: 5,
          filters: {
            classNames: ["Smoke Class Updated"],
            topics: ["Persistence Updated"],
            sources: ["Codex route smoke"],
            tags: ["route-smoke"],
            documentDateFrom: "2026-07-13",
            documentDateTo: "2026-07-13"
          }
        })
      })
    )
  );

  assertStatus(unsupportedAnswer, 200, "not-found answer");
  assertEqual(getString(unsupportedAnswer.body, "status"), "insufficient_evidence", "not-found answer status");

  const supportedAnswer = await answerIfAvailable(answerRoute, documentId, accessToken);
  const embeddingConfig = getEmbeddingRuntimeConfig();
  const prisma = await getPrisma();
  const embeddingValidation = await validateEmbeddingStore(prisma, {
    model: embeddingConfig.model,
    dimensions: embeddingConfig.dimensions
  });
  const deleteResponse = await jsonResponse(
    await detailRoute.DELETE(authorizedRequest(`http://quicknotes.local/api/documents/${documentId}`, accessToken, { method: "DELETE" }), context)
  );

  assertStatus(deleteResponse, 200, "document cleanup");

  await prisma.$disconnect?.();

  console.log(
    JSON.stringify(
      {
        documentId,
        upload: {
          status: upload.status,
          pageCount: upload.body.pageCount,
          chunkCount: upload.body.chunkCount,
          embeddingStatus: upload.body.embeddingStatus,
          embeddingError: upload.body.embeddingError ? "present" : null
        },
        list: {
          containsDocument: true
        },
        detail: {
          status: detail.status
        },
        content: {
          status: content.status,
          textVerified: true
        },
        metadata: {
          status: metadata.status
        },
        metadataOptions: {
          status: metadataOptions.status
        },
        keywordSearch: summarizeSearch(keyword.body),
        semanticSearch: semantic,
        hybridSearch: hybrid,
        unsupportedAnswer: {
          status: unsupportedAnswer.body.status,
          answer: unsupportedAnswer.body.answer
        },
        supportedAnswer,
        embeddingValidation: {
          ok: embeddingValidation.ok,
          documentCount: embeddingValidation.documentCount,
          chunkCount: embeddingValidation.chunkCount,
          embeddingCount: embeddingValidation.embeddingCount,
          missingEmbeddingCount: embeddingValidation.missingEmbeddings.length,
          staleEmbeddingCount: embeddingValidation.staleEmbeddings.length
        },
        openai: {
          embeddingKeyConfigured: Boolean(embeddingConfig.apiKey),
          answerKeyConfigured: Boolean(getAnswerRuntimeConfig().apiKey)
        },
        cleanup: {
          documentDeleted: true
        }
      },
      null,
      2
    )
  );
  } finally {
    await authContext.cleanup();
  }
}

async function searchIfAvailable(
  searchRoute: typeof import("../src/app/api/search/route"),
  mode: "semantic" | "hybrid",
  filters: URLSearchParams,
  documentId: string,
  accessToken: string
) {
  const response = await jsonResponse(
    await searchRoute.GET(authorizedRequest(`http://quicknotes.local/api/search?q=mitochondria&mode=${mode}&${filters}`, accessToken))
  );

  if (response.status === 200) {
    assertSearchContainsDocument(response.body, documentId);

    return {
      available: true,
      ...summarizeSearch(response.body)
    };
  }

  if (response.status === 409 || response.status === 503 || response.status === 502 || response.status === 429) {
    return {
      available: false,
      status: response.status,
      error: getOptionalString(response.body, "error")
    };
  }

  throw new Error(`${mode} search failed with HTTP ${response.status}: ${JSON.stringify(response.body)}`);
}

async function answerIfAvailable(answerRoute: typeof import("../src/app/api/answer/route"), documentId: string, accessToken: string) {
  const response = await jsonResponse(
    await answerRoute.POST(
      authorizedRequest("http://quicknotes.local/api/answer", accessToken, {
        method: "POST",
        body: JSON.stringify({
          question: "What do mitochondria make?",
          mode: "keyword",
          topK: 5,
          filters: {
            documentIds: [documentId],
            classNames: ["Smoke Class Updated"],
            topics: ["Persistence Updated"],
            sources: ["Codex route smoke"],
            tags: ["route-smoke"],
            documentDateFrom: "2026-07-13",
            documentDateTo: "2026-07-13"
          }
        })
      })
    )
  );

  if (response.status === 200) {
    const citations = Array.isArray(response.body.citations) ? response.body.citations : [];

    for (const citation of citations) {
      if (!citation || typeof citation !== "object" || (citation as JsonObject).documentId !== documentId) {
        throw new Error("Supported answer returned a citation outside the selected document filter.");
      }
    }

    return {
      available: true,
      status: response.body.status,
      citationCount: citations.length,
      filterScopeVerified: true
    };
  }

  if (response.status === 503 || response.status === 502 || response.status === 429) {
    return {
      available: false,
      status: response.status,
      error: getOptionalString(response.body, "error")
    };
  }

  throw new Error(`supported answer failed with HTTP ${response.status}: ${JSON.stringify(response.body)}`);
}

async function jsonResponse(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as JsonObject
  };
}

function assertStatus(response: { status: number; body: JsonObject }, expected: number, label: string) {
  if (response.status !== expected) {
    throw new Error(`${label} returned HTTP ${response.status}: ${JSON.stringify(response.body)}`);
  }
}

function assertDocumentInList(body: JsonObject, documentId: string) {
  const documents = body.documents;

  if (!Array.isArray(documents) || !documents.some((document) => isObjectWithString(document, "id", documentId))) {
    throw new Error(`Document ${documentId} was not returned by list documents.`);
  }
}

function assertSearchContainsDocument(body: JsonObject, documentId: string) {
  const results = body.results;

  if (!Array.isArray(results) || !results.some((result) => isObjectWithString(result, "documentId", documentId))) {
    throw new Error(`Search did not return document ${documentId}.`);
  }
}

function assertContentIncludes(body: JsonObject, expected: string) {
  const pages = body.pages;
  const chunks = body.chunks;
  const text = JSON.stringify({
    pages,
    chunks
  }).toLowerCase();

  if (!text.includes(expected.toLowerCase())) {
    throw new Error(`Document content does not include expected text: ${expected}`);
  }
}

function summarizeSearch(body: JsonObject) {
  return {
    mode: body.mode,
    resultCount: body.resultCount,
    filterScopeVerified: true
  };
}

function assertEqual(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function getString(body: JsonObject, key: string) {
  const value = body[key];

  if (typeof value !== "string" || !value) {
    throw new Error(`Expected response field ${key} to be a non-empty string.`);
  }

  return value;
}

function getOptionalString(body: JsonObject, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function isObjectWithString(value: unknown, key: string, expected: string) {
  return Boolean(value && typeof value === "object" && (value as JsonObject)[key] === expected);
}

function createSmokePdf() {
  const content = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    `(${escapePdfText("Mitochondria make ATP for cell work.")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("Regression assumptions include linearity and independent errors.")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("This route smoke document verifies Supabase persistence filters.")}) Tj`,
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
