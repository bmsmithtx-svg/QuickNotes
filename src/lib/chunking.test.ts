import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chunkPageText } from "./chunking";

describe("chunkPageText", () => {
  it("keeps a short page as one exact chunk", () => {
    const text = "The mitochondria convert stored energy into ATP for the cell.";
    const chunks = chunkPageText({ documentId: "doc_1", pageNumber: 4, text });

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].documentId, "doc_1");
    assert.equal(chunks[0].pageNumber, 4);
    assert.equal(chunks[0].chunkIndex, 0);
    assert.equal(chunks[0].text, text);
    assert.equal(chunks[0].characterCount, text.length);
  });

  it("creates ordered chunks that keep page numbers", () => {
    const paragraph = "Photosynthesis stores energy in glucose. Chloroplasts contain chlorophyll for light capture.";
    const text = Array.from({ length: 24 }, () => paragraph).join("\n\n");
    const chunks = chunkPageText({
      documentId: "doc_2",
      pageNumber: 9,
      text,
      targetCharacters: 420,
      maxCharacters: 520,
      minCharacters: 120
    });

    assert.ok(chunks.length > 1);
    chunks.forEach((chunk, index) => {
      assert.equal(chunk.pageNumber, 9);
      assert.equal(chunk.chunkIndex, index);
      assert.ok(chunk.characterCount <= 520);
      assert.ok(chunk.text.includes("Photosynthesis"));
    });
  });

  it("merges a tiny trailing chunk when it fits", () => {
    const longText = `${"A stable sentence about cells. ".repeat(18)}\n\nshort tail`;
    const chunks = chunkPageText({
      documentId: "doc_3",
      pageNumber: 2,
      text: longText,
      targetCharacters: 180,
      maxCharacters: 620,
      minCharacters: 120
    });

    assert.ok(chunks.at(-1)?.text.endsWith("short tail"));
    assert.ok((chunks.at(-1)?.characterCount ?? 0) > 120);
  });
});
