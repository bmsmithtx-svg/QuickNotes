import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeRetrievalFilters,
  normalizeTagName,
  normalizeTagsInput,
  parseDocumentMetadataUpdatePayload,
  replaceDocumentTags
} from "./metadata";
import { appendRetrievalFilterSql } from "./retrieval-filters";

describe("metadata normalization", () => {
  it("trims metadata text, converts empty strings to null, and validates dates", () => {
    const result = parseDocumentMetadataUpdatePayload({
      className: "  Data Analytics  ",
      topic: "",
      source: " Course Textbook ",
      documentDate: "2026-07-12",
      tags: [" statistics ", "STATISTICS", " exam-2 "]
    });

    assert.equal(result.ok, true);

    if (result.ok) {
      assert.equal(result.value.className, "Data Analytics");
      assert.equal(result.value.topic, null);
      assert.equal(result.value.source, "Course Textbook");
      assert.equal(result.value.documentDate?.toISOString(), "2026-07-12T00:00:00.000Z");
      assert.deepEqual(
        result.value.tags?.map((tag) => tag.name),
        ["exam-2", "statistics"]
      );
    }
  });

  it("prevents duplicate tags with deterministic case-insensitive matching", () => {
    assert.equal(normalizeTagName(" Exam  2 "), "exam 2");
    assert.deepEqual(normalizeTagsInput(["Exam 2", " exam 2 ", "EXAM 2"]).map((tag) => tag.name), ["Exam 2"]);
  });

  it("rejects invalid metadata update shapes", () => {
    assert.equal(parseDocumentMetadataUpdatePayload({ documentDate: "2026-02-31" }).ok, false);
    assert.equal(parseDocumentMetadataUpdatePayload({ tags: "exam" }).ok, false);
    assert.equal(parseDocumentMetadataUpdatePayload({}).ok, false);
  });
});

describe("retrieval filter contract", () => {
  it("normalizes OR values within categories and keeps date boundaries inclusive", () => {
    const filters = normalizeRetrievalFilters({
      documentIds: ["doc_b", " doc_a ", "doc_a"],
      classNames: ["Biology", "Chemistry"],
      tags: ["Exam", "exam"],
      documentDateFrom: "2026-07-01",
      documentDateTo: "2026-07-31"
    });

    assert.deepEqual(filters.documentIds, ["doc_a", "doc_b"]);
    assert.deepEqual(filters.classNames, ["Biology", "Chemistry"]);
    assert.deepEqual(filters.tags, ["Exam"]);
    assert.equal(filters.documentDateFrom, "2026-07-01");
    assert.equal(filters.documentDateTo, "2026-07-31");
    assert.equal(filters.tagMatch, "any");
  });

  it("builds ANDed SQL categories with OR semantics inside each category and match-any tag semantics", () => {
    const filters = normalizeRetrievalFilters({
      documentIds: ["doc_a", "doc_b"],
      classNames: ["Biology", "Chemistry"],
      topics: ["cells"],
      sources: ["Course notes"],
      tags: ["exam", "week 3"],
      documentDateFrom: "2026-07-01",
      documentDateTo: "2026-07-31"
    });
    const clauses: string[] = [];
    const parameters: unknown[] = [];

    appendRetrievalFilterSql(clauses, parameters, filters);

    assert.match(clauses.join(" AND "), /"document"\."id" IN \(\$1, \$2\)/);
    assert.match(clauses.join(" AND "), /"document"\."className" IN \(\$3, \$4\)/);
    assert.match(clauses.join(" AND "), /"document"\."topic" = \$5/);
    assert.match(clauses.join(" AND "), /"document"\."source" = \$6/);
    assert.match(clauses.join(" AND "), /"document"\."documentDate" >= \$7::date/);
    assert.match(clauses.join(" AND "), /"document"\."documentDate" <= \$8::date/);
    assert.match(clauses.join(" AND "), /"filterTag"\."normalizedName" IN \(\$9, \$10\)/);
    assert.deepEqual(parameters.slice(0, 6), ["doc_a", "doc_b", "Biology", "Chemistry", "cells", "Course notes"]);
    assert.equal(parameters.at(-2), "exam");
    assert.equal(parameters.at(-1), "week 3");
  });

  it("rejects reversed date ranges instead of falling back to unfiltered retrieval", () => {
    assert.throws(
      () =>
        normalizeRetrievalFilters({
          documentDateFrom: "2026-07-31",
          documentDateTo: "2026-07-01"
        }),
      /documentDateFrom/
    );
  });
});

describe("document tag writes", () => {
  it("replaces document tags transactionally without inserting duplicate document-tag links", async () => {
    const calls: Array<{ method: string; args: unknown }> = [];
    let nextTagId = 0;
    const transaction = {
      documentTag: {
        deleteMany: async (args: unknown) => {
          calls.push({ method: "deleteMany", args });
          return {};
        },
        create: async (args: unknown) => {
          calls.push({ method: "createDocumentTag", args });
          return {};
        }
      },
      tag: {
        upsert: async (args: unknown) => {
          calls.push({ method: "upsertTag", args });
          nextTagId += 1;
          return { id: `tag_${nextTagId}` };
        }
      }
    };

    await replaceDocumentTags(transaction, "doc_1", normalizeTagsInput(["Exam", "exam", "week 3"]));

    assert.deepEqual(
      calls.map((call) => call.method),
      ["deleteMany", "upsertTag", "createDocumentTag", "upsertTag", "createDocumentTag"]
    );
  });
});
