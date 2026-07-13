import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cosineSimilarity, normalizeVector, parseStoredVector, serializeVectorForPgvector } from "./vector-utils";

describe("vector utilities", () => {
  it("normalizes vectors to unit length", () => {
    const normalized = normalizeVector([3, 4]);

    assert.equal(Number(normalized[0].toFixed(4)), 0.6);
    assert.equal(Number(normalized[1].toFixed(4)), 0.8);
  });

  it("computes cosine similarity", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
    assert.equal(Number(cosineSimilarity([1, 1], [1, 0]).toFixed(4)), 0.7071);
  });

  it("validates stored vector JSON dimensions", () => {
    assert.deepEqual(parseStoredVector("[0.1,0.2]", 2), [0.1, 0.2]);
    assert.throws(() => parseStoredVector("[0.1]", 2), /dimensions mismatch/);
  });

  it("serializes pgvector literals and validates dimensions", () => {
    assert.equal(serializeVectorForPgvector([0.1, -0.2], 2), "[0.1,-0.2]");
    assert.throws(() => serializeVectorForPgvector([0.1], 2), /Embedding dimensions mismatch/);
    assert.throws(() => serializeVectorForPgvector([Number.NaN], 1), /non-finite/);
  });
});
