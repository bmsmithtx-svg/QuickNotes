# QuickNotes

QuickNotes is a local-first study app for learning from uploaded course material. Students can upload PDF textbooks, class notes, and study documents, search extracted chunks, and ask questions that are answered only from retrieved source evidence.

The current milestone adds citation-backed answer generation on top of the existing hybrid retrieval pipeline. QuickNotes still uses Next.js, Prisma, and SQLite; it does not use hosted vector databases or external app backends.

## Architecture

- Next.js App Router serves the workspace UI and API routes.
- Prisma with local SQLite stores document metadata, page text, chunks, and chunk embeddings.
- `pdfjs-dist` extracts text from uploaded PDF text layers.
- SQLite FTS5 powers keyword retrieval through a rebuildable `DocumentChunkSearch` mirror.
- `DocumentChunkEmbedding` stores normalized OpenAI embedding vectors as JSON for local semantic scans.
- Hybrid retrieval combines keyword and semantic candidates with Reciprocal Rank Fusion.
- Answer generation reuses `retrieveChunks`; there is no separate answer-specific retrieval path.
- OpenAI calls are isolated in server-side services under `src/lib/server/`.

## Environment Variables

```bash
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4o-mini
```

- `OPENAI_API_KEY` enables upload-time embeddings, semantic/hybrid retrieval, and answer generation.
- `OPENAI_EMBEDDING_MODEL` defaults to `text-embedding-3-small`.
- `OPENAI_CHAT_MODEL` defaults to `gpt-4o-mini`.
- API keys are read only on the server and are never exposed to browser code.

Without an API key, uploads, document browsing, and keyword search remain usable. Answer generation needs an API key when retrieved evidence exists.

## Local Setup

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

Local runtime data is ignored by git:

- Uploaded PDFs: `storage/uploads/`
- Extracted/generated local data: `storage/extracted/`
- SQLite database: `prisma/quicknotes.dev.db`
- `.env`, SQLite journals, uploads, cache files, and build output

## Search API

```text
GET /api/search?q=mitochondria&mode=hybrid&limit=8
```

Optional filters:

```text
documentId=<document id>
class=<class name>
topic=<topic>
tag=<tag>
limit=<1-50>
mode=<keyword|semantic|hybrid>
```

Search returns ranked chunks with file, page, chunk, score, rank, detailed ranking metadata, and exact source chunk text in `citation.sourceChunk`.

## Answer API

```text
POST /api/answer
Content-Type: application/json
```

Request:

```json
{
  "question": "string",
  "documentIds": ["optional-document-id"],
  "mode": "keyword",
  "topK": 8
}
```

Response:

```json
{
  "status": "answered",
  "answer": "Mitochondria make ATP [1].",
  "citations": [
    {
      "id": 1,
      "marker": "[1]",
      "documentId": "doc_id",
      "documentTitle": "Cell Energy Notes",
      "documentFileName": "cell-energy.pdf",
      "pageNumber": 2,
      "chunkId": "chunk_id",
      "chunkIndex": 1,
      "sourceText": "Exact retrieved source chunk text.",
      "retrievalRank": 1,
      "retrievalScore": 0.0325,
      "retrievalMetadata": {
        "mode": "hybrid",
        "finalRank": 1,
        "finalScore": 0.0325,
        "keywordRank": 2,
        "keywordScore": 8,
        "semanticRank": 1,
        "semanticSimilarity": 0.91
      }
    }
  ],
  "retrievedChunks": [],
  "retrievalMode": "hybrid",
  "model": "gpt-4o-mini"
}
```

`documentIds` is optional. When present, keyword, semantic, and hybrid retrieval all apply the same document filter inside the shared retrieval helpers.

## Citation Format

Generated answers cite sources with stable markers such as `[1]`, `[2]`, and `[3]`.

Each returned citation includes:

- Citation ID and marker
- Document ID
- Document title and original filename
- Page number
- Chunk ID and chunk index
- Exact retrieved source text
- Retrieval rank
- Retrieval score and ranking metadata

The answer service validates every marker in the generated answer. If the model cites a marker that is not in the returned citation set, or answers without citations, QuickNotes returns insufficient evidence instead of the model answer.

Duplicate retrieved chunks are collapsed by `chunkId`, and duplicate answer markers return one citation entry.

## Grounding Policy

Answers must be grounded exclusively in retrieved chunks.

- The model prompt says to use only supplied `SOURCE_CHUNKS`.
- The prompt forbids outside knowledge, memory, assumptions, and unstated facts.
- Every factual claim in an answered response must include citation markers.
- The server validates citation markers after generation.
- If retrieval returns no source chunks with exact text, the LLM is not called.

Insufficient evidence response:

```text
I couldn't find enough information in the selected sources to answer that question.
```

QuickNotes returns this exact text when retrieval finds no usable chunks, when the model reports insufficient evidence, when citation markers are invalid, or when an answered response has no citations.

## Prompt Injection Defenses

Uploaded PDFs are treated as untrusted data, not instructions.

- Source chunks are serialized as structured JSON context.
- System instructions explicitly tell the model to ignore commands, policies, secrets, role changes, and tool-use requests inside source chunks.
- Prompt-injection text inside PDFs is never executed; it is only quoted as source evidence.
- The browser never receives `OPENAI_API_KEY`.

## Ask QuickNotes UI

The workspace includes an "Ask QuickNotes" panel with:

- Question input
- Keyword, semantic, and hybrid mode selector
- Optional document filter
- Loading and API error states
- Insufficient-evidence state
- Answer display with clickable citation markers
- Citation buttons that reveal document name, page number, rank, score, filename, and exact retrieved chunk

## Manual Smoke Tests

```bash
npm run smoke:retrieval
npm run smoke:answer
```

`smoke:retrieval` verifies deterministic semantic and hybrid ranking with fake vectors.

`smoke:answer` requires `OPENAI_API_KEY`. With a key, it verifies:

- Supported question
- Unsupported question
- Document filtering
- Citation markers
- Page numbers
- Chunk metadata
- Prompt-injection source text treated as source data

Without a key, it prints a skip message and exits successfully.

## Automated Checks

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run smoke:retrieval
npm run smoke:answer
npm run build
```

Current verification from July 13, 2026:

- `npm run lint` passed and printed `eslint config ok`.
- `npm run typecheck` passed.
- `npm run test:unit` passed with 31 tests.
- `npm run smoke:retrieval` initially hit a sandbox `tsx` IPC permission error, then passed outside the sandbox.
- `npm run smoke:answer` initially hit the same sandbox `tsx` IPC permission error, then skipped outside the sandbox because `OPENAI_API_KEY` is not configured in this shell.
- `npx prisma --version` completed with Prisma 6.19.3, `@prisma/client` 6.19.3, Node.js v25.9.0, darwin-arm64 engines.
- `npx prisma validate` passed.
- `npm run build` still hangs after printing only the npm script line and `next build --webpack`; it was interrupted after about one minute both sandboxed and unsandboxed.

## Privacy Considerations

- OpenAI keys are server-only environment variables.
- Full document text is sent to OpenAI only for retrieved answer context or embedding generation.
- Full private document content is not logged by retrieval, embedding, or answer helpers.
- Uploaded PDFs, local SQLite databases, extracted data, and generated artifacts are ignored by git.
- There is no authentication or deployment in this milestone.

## Limitations

- Semantic retrieval scans JSON vectors in-process, so it is intended for local or small datasets.
- Embeddings are stored as JSON, not in a vector index.
- Only one embedding row is stored per chunk.
- Answer faithfulness still relies on prompt instructions plus marker validation; it does not yet split every sentence into independently verified claims.
- OCR for scanned PDFs is not implemented.
- The Next.js production build hang remains unresolved in this local runtime.

## Development Log

### 2026-07-13 Citation-backed answer generation

Changed:

- Added server-side answer generation using `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL`.
- Added `POST /api/answer`.
- Reused the existing keyword, semantic, and hybrid retrieval helpers for answer context.
- Added multi-document filtering inside the shared retrieval input.
- Added numbered citation construction, exact source chunk preservation, marker validation, duplicate citation handling, and insufficient-evidence fallback.
- Added prompt-injection defenses for untrusted uploaded PDF text.
- Added the Ask QuickNotes UI with document filtering, loading/error states, insufficient-evidence state, answer display, and clickable citations.
- Added unit tests for validation, context creation, prompt injection resistance, insufficient evidence, citation validation, hallucinated citation IDs, duplicate citations, document filtering, deterministic ordering, and OpenAI failures.
- Added `scripts/answer-smoke.ts` and `npm run smoke:answer`.

Current status:

- Citation-backed answer generation is implemented server-side.
- Unit tests do not require a real API key and mock all OpenAI behavior.
- Real answer smoke testing requires setting `OPENAI_API_KEY`.
- Prisma CLI version and validation commands now complete in this run.
- `npm run build` still hangs before Next.js emits build details.

Next milestone:

- Fix the Next.js build hang, then add answer faithfulness evaluation fixtures and browser-level UI tests for Ask QuickNotes.
