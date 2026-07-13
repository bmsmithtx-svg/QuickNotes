import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeFtsQuery, searchChunks, syncDocumentSearchIndex } from "./search-index";
import type { PrismaTransactionLike } from "./db";

const delegate = {
  findMany: async () => [],
  findUnique: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  createMany: async () => ({})
};

describe("search index helpers", () => {
  it("normalizes user text into a safe FTS query", () => {
    assert.equal(normalizeFtsQuery("Mitochondria + ATP? ATP"), '"mitochondria" "atp"');
    assert.equal(normalizeFtsQuery("?!"), null);
  });

  it("returns ranked chunks with citation metadata", async () => {
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const db: PrismaTransactionLike = {
      studyDocument: delegate,
      documentPage: delegate,
      documentChunk: delegate,
      $executeRawUnsafe: async (query, ...values) => {
        calls.push({ query, values });
        return 0;
      },
      $queryRawUnsafe: async <Result = unknown>(query: string, ...values: unknown[]) => {
        calls.push({ query, values });
        assert.match(query, /"DocumentChunkSearch" MATCH \?/);
        assert.deepEqual(values, ['"mitochondria" "atp"', "doc_1", "Biology", "cells", "exam", 5]);

        return [
          {
            chunkId: "chunk_1",
            documentId: "doc_1",
            documentTitle: "Cell Energy Notes",
            originalFileName: "cell-energy.pdf",
            className: "Biology",
            topic: "cells",
            source: "Course notes",
            documentDate: "2026-07-12T00:00:00.000Z",
            tags: '["exam","week 3"]',
            pageNumber: 4,
            chunkIndex: 2,
            text: "The mitochondria convert stored energy into ATP for the cell.",
            score: 0.7821
          }
        ] as Result;
      }
    };

    const results = await searchChunks(db, {
      query: "mitochondria ATP",
      documentId: "doc_1",
      className: "Biology",
      topic: "cells",
      tag: "exam",
      limit: 5
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].chunkId, "chunk_1");
    assert.equal(results[0].documentId, "doc_1");
    assert.equal(results[0].documentTitle, "Cell Energy Notes");
    assert.equal(results[0].originalFileName, "cell-energy.pdf");
    assert.equal(results[0].source, "Course notes");
    assert.equal(results[0].documentDate, "2026-07-12");
    assert.equal(results[0].pageNumber, 4);
    assert.equal(results[0].chunkIndex, 2);
    assert.equal(results[0].rank, 1);
    assert.equal(results[0].score, 0.7821);
    assert.deepEqual(results[0].tags, ["exam", "week 3"]);
    assert.deepEqual(results[0].citation, {
      id: "chunk_1",
      fileName: "cell-energy.pdf",
      pageNumber: 4,
      chunkIndex: 2,
      sourceChunk: "The mitochondria convert stored energy into ATP for the cell."
    });
    assert.equal(calls.length, 3);
  });

  it("replaces a document's existing search rows before indexing chunks", async () => {
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const db: PrismaTransactionLike = {
      studyDocument: delegate,
      documentPage: delegate,
      documentChunk: delegate,
      $executeRawUnsafe: async (query, ...values) => {
        calls.push({ query, values });
        return 0;
      },
      $queryRawUnsafe: async <Result = unknown>() => [] as Result
    };

    await syncDocumentSearchIndex(db, "doc_2", [
      {
        id: "chunk_2",
        documentId: "doc_2",
        text: "Photosynthesis stores energy in glucose."
      }
    ]);

    assert.match(calls[0].query, /DELETE FROM "DocumentChunkSearch"/);
    assert.deepEqual(calls[0].values, ["doc_2"]);
    assert.match(calls[1].query, /INSERT INTO "DocumentChunkSearch"/);
    assert.deepEqual(calls[1].values, ["chunk_2", "doc_2", "Photosynthesis stores energy in glucose."]);
  });
});
