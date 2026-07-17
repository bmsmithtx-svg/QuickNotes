import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DocumentContentResponse, StudyDocumentSummary } from "../lib/types";
import {
  applySavedDocumentToWorkspaceState,
  getMetadataPanelState,
  getWorkspaceTabHref,
  normalizeWorkspaceTab,
  resolveSelectedDocumentIdAfterLoad
} from "./quicknotes-workspace";

describe("workspace tab navigation state", () => {
  it("defaults invalid or missing tab values to PDFs", () => {
    assert.equal(normalizeWorkspaceTab(null), "pdfs");
    assert.equal(normalizeWorkspaceTab("settings"), "pdfs");
    assert.equal(normalizeWorkspaceTab("search"), "search");
    assert.equal(normalizeWorkspaceTab("metadata"), "metadata");
  });

  it("builds tab URLs while preserving the selected document", () => {
    assert.equal(
      getWorkspaceTabHref("https://quicknotes.local/?tab=pdfs&documentId=doc_a", "metadata", "doc_a"),
      "/?tab=metadata&documentId=doc_a"
    );
    assert.equal(getWorkspaceTabHref("https://quicknotes.local/?tab=metadata&documentId=doc_a", "pdfs", null), "/?tab=pdfs");
  });
});

describe("workspace selected document state", () => {
  it("preserves the selected document across library reloads", () => {
    const documents = [makeDocument("doc_a"), makeDocument("doc_b")];

    assert.equal(resolveSelectedDocumentIdAfterLoad("doc_b", documents), "doc_b");
    assert.equal(resolveSelectedDocumentIdAfterLoad(null, documents, "doc_b"), "doc_b");
    assert.equal(resolveSelectedDocumentIdAfterLoad("missing", documents), "doc_a");
    assert.equal(resolveSelectedDocumentIdAfterLoad(null, []), null);
  });
});

describe("workspace metadata state", () => {
  it("chooses the right metadata panel state", () => {
    const documents = [makeDocument("doc_a")];

    assert.equal(getMetadataPanelState(documents[0], documents), "editor");
    assert.equal(getMetadataPanelState(null, documents), "selector");
    assert.equal(getMetadataPanelState(null, []), "pdfs-tab-button");
  });

  it("applies saved metadata to shared document and content state", () => {
    const originalDocument = makeDocument("doc_a", { title: "Original", source: "Slides" });
    const savedDocument = makeDocument("doc_a", { title: "Updated", source: "Textbook", tags: ["exam"] });
    const otherDocument = makeDocument("doc_b");
    const content = makeContent(originalDocument);

    const nextState = applySavedDocumentToWorkspaceState([originalDocument, otherDocument], content, savedDocument);

    assert.equal(nextState.documents[0].title, "Updated");
    assert.equal(nextState.documents[0].source, "Textbook");
    assert.deepEqual(nextState.documents[0].tags, ["exam"]);
    assert.equal(nextState.documents[1], otherDocument);
    assert.equal(nextState.content?.document.title, "Updated");
    assert.equal(nextState.content?.document.source, "Textbook");
  });
});

function makeDocument(id: string, overrides: Partial<StudyDocumentSummary> = {}): StudyDocumentSummary {
  return {
    id,
    originalFileName: `${id}.pdf`,
    storedFileName: `${id}-stored.pdf`,
    fileSize: 1024,
    mimeType: "application/pdf",
    storageProvider: "local",
    storageBucket: "local",
    storageObjectKey: `${id}.pdf`,
    contentSha256: null,
    title: id,
    className: null,
    topic: null,
    source: null,
    documentDate: null,
    tags: [],
    uploadStatus: "READY",
    pageCount: 1,
    chunkCount: 1,
    failureStage: null,
    failureReason: null,
    processingAttemptCount: 1,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides
  };
}

function makeContent(document: StudyDocumentSummary): DocumentContentResponse {
  return {
    document: {
      ...document,
      pageTextCount: 1
    },
    pages: [],
    chunks: [],
    pageTotal: 0,
    chunkTotal: 0
  };
}
