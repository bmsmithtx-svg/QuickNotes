import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaTransactionLike } from "./db";
import { getMetadataOptions, mapMetadataOptionRows } from "./metadata-options";

const delegate = {
  findMany: async () => [],
  findUnique: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  createMany: async () => ({})
};

describe("metadata option aggregation", () => {
  it("maps count rows into deterministic API options", () => {
    assert.deepEqual(
      mapMetadataOptionRows([
        { value: "Biology", count: BigInt(2) },
        { value: "Chemistry", count: 1 }
      ]),
      [
        { value: "Biology", count: 2 },
        { value: "Chemistry", count: 1 }
      ]
    );
  });

  it("queries classes, topics, sources, and normalized tags", async () => {
    const queries: string[] = [];
    const db: PrismaTransactionLike = {
      studyDocument: delegate,
      documentPage: delegate,
      documentChunk: delegate,
      $executeRawUnsafe: async () => 0,
      $queryRawUnsafe: async <Result = unknown>(query: string) => {
        queries.push(query);

        if (query.includes('"className"')) {
          return [{ value: "Biology", count: 2 }] as Result;
        }

        if (query.includes('"topic"')) {
          return [{ value: "Regression", count: 3 }] as Result;
        }

        if (query.includes('"source"')) {
          return [{ value: "Course notes", count: 4 }] as Result;
        }

        return [{ value: "exam-2", count: 1 }] as Result;
      }
    };

    const options = await getMetadataOptions(db);

    assert.deepEqual(options.classes, [{ value: "Biology", count: 2 }]);
    assert.deepEqual(options.topics, [{ value: "Regression", count: 3 }]);
    assert.deepEqual(options.sources, [{ value: "Course notes", count: 4 }]);
    assert.deepEqual(options.tags, [{ value: "exam-2", count: 1 }]);
    assert.equal(queries.length, 4);
    assert.match(queries[3], /COUNT\(DISTINCT "documentTag"\."documentId"\)/);
  });
});
