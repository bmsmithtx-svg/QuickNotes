# QuickNotes

QuickNotes is a school-focused AI study app for learning from uploaded course material. The product goal is to let students upload PDF textbooks, class notes, and study documents, then ask questions and receive answers backed by citations from the source material.

The long-term system will ingest PDFs, chunk and embed document text, perform hybrid semantic and keyword retrieval, and generate source-grounded answers with file and page references plus hallucination fallback controls.

The app is being built as a resume-quality AI knowledge system, not a tutorial clone. The first version starts with a clean Next.js foundation and a product-shaped workspace so the document ingestion, retrieval, citation, and evaluation layers can be added without rewriting the app.

## Planned Features

- Upload PDF textbooks, class notes, and study documents.
- Extract text from PDFs and store document metadata.
- Search uploaded chunks locally with keyword, semantic, and hybrid retrieval plus file/page/chunk citations.
- Answer questions with citation-backed evidence that includes file name, page number, and exact source chunk.
- Fall back to "not found in sources" when uploaded material does not support an answer.
- Use hybrid retrieval with semantic/vector search plus keyword/BM25-style search.
- Filter documents by class, topic, date, source, and tag.
- Add evaluation tests for retrieval accuracy, citation accuracy, and answer faithfulness.
- Deploy the full app after the local upload, database, retrieval, and answer flows are stable.

## Initial Tech Stack

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- API routes for backend endpoints
- Prisma with local SQLite for document metadata, page text, and chunks
- SQLite FTS5 for local keyword retrieval over chunks
- `pdfjs-dist` for local text-layer PDF extraction
- OpenAI API for embeddings, with answer generation planned next

## Current Structure

```text
prisma/              Prisma schema and migrations
src/app/              Next.js app routes and API routes
src/components/       Reusable UI components
src/lib/              Shared product types and starter data
storage/              Local ignored uploads/extracted data created at runtime
```

## Local Setup

Install dependencies:

```bash
npm install
```

Generate the Prisma client and apply the local SQLite migration:

```bash
npx prisma generate
npx prisma migrate dev
```

Run the development server:

```bash
npm run dev
```

Optional OpenAI embedding configuration:

```bash
cp .env.example .env
# Add a real key locally. Do not commit .env.
OPENAI_API_KEY=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

`OPENAI_API_KEY` enables upload-time embeddings, semantic search, and hybrid search. Without it, uploads, document browsing, and keyword search remain usable. `OPENAI_EMBEDDING_MODEL` defaults to `text-embedding-3-small` and can be changed before running backfill; changing the model marks existing chunk embeddings stale.

Run checks:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run smoke:retrieval
npm run build
```

Do not commit local secrets, PDFs, databases, extracted chunks, embeddings, or generated document artifacts. The `.gitignore` is set up to keep those files out of git.

Local development data:

- Uploaded PDFs are stored under `storage/uploads/`.
- Extracted/generated local data can live under `storage/extracted/`.
- The local SQLite database is `prisma/quicknotes.dev.db`.
- SQLite journals, uploaded PDFs, storage folders, cache files, build output, and environment files are intentionally ignored by git.

PDF extraction is deterministic and local. It reads the embedded PDF text layer by page; scanned/image-only PDFs will need OCR later.

## Retrieval Search

QuickNotes now supports local keyword retrieval, semantic retrieval, and deterministic hybrid retrieval over ingested PDF chunks. It does not generate AI answers yet.

Endpoint:

```text
GET /api/search?q=mitochondria
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

Examples:

```text
GET /api/search?q=mitochondria%20ATP&class=Biology&tag=exam&limit=5&mode=hybrid
GET /api/search?q=cellular%20respiration&mode=semantic
GET /api/search?q=ATP&mode=keyword
```

Response shape:

- `query`: the submitted query.
- `requestedMode`: `auto` when no mode was supplied, otherwise `keyword`, `semantic`, or `hybrid`.
- `mode` / `actualMode`: the retrieval mode actually used.
- `semantic`: availability metadata with the embedding model and missing-key/missing-embedding reason when unavailable.
- `resultCount`: number of returned chunks.
- `ranking`: ranking formula metadata.
- `filters`: applied document/class/topic/tag filters.
- `results`: ranked chunks with `chunkId`, `documentId`, `documentTitle`, `originalFileName`, `pageNumber`, `chunkIndex`, `textPreview`, backward-compatible `score` and `rank`, detailed `ranking` metadata, and a `citation` object containing the exact source chunk text.

Keyword retrieval:

- Search uses SQLite FTS5 with `bm25()` ordering over `DocumentChunk.text`.
- `StudyDocument`, `DocumentPage`, and `DocumentChunk` remain the source-of-truth Prisma models. The `DocumentChunkSearch` FTS table is a rebuildable mirror.
- Upload processing syncs newly extracted chunks into the FTS table, and the search helper backfills existing chunks idempotently if the index is missing rows.
- The query normalizer tokenizes user input into safe keyword terms.

Semantic retrieval architecture:

- `DocumentChunkEmbedding` stores one embedding row per chunk with `chunkId`, `embeddingModel`, `dimensions`, JSON-serialized normalized vector data, `contentHash`, and timestamps.
- `contentHash` is a SHA-256 hash of exact chunk text. A chunk is skipped when the stored hash and model match; it is re-embedded when either changes.
- `src/lib/server/embedding-service.ts` isolates OpenAI API calls, batching, response validation, vector normalization, and typed error handling.
- Retrieval code receives an injected embedding service, so ranking tests use deterministic fake vectors and never call the network.
- The current SQLite implementation scans stored vectors in-process and ranks with cosine similarity. The interface is isolated so a later vector index can replace the scan.

Hybrid search architecture:

- Keyword and semantic candidates are fetched separately.
- Results are deduplicated by `chunkId`.
- Hybrid scoring uses Reciprocal Rank Fusion: `score = sum(1 / (60 + rank)) over keyword and semantic ranks`.
- Raw BM25 and cosine scores are not directly added.
- Ties are deterministic: final score desc, keyword rank asc, semantic rank asc, semantic similarity desc, document ID asc, page asc, chunk index asc, chunk ID asc.
- Hybrid results preserve `keywordRank`, `keywordScore`, `semanticRank`, `semanticSimilarity`, final rank, final score, and citation metadata.

Embedding backfill and rebuild:

```bash
npm run embeddings:backfill  # missing or stale embeddings
npm run embeddings:missing   # only chunks with no embedding row
npm run embeddings:rebuild   # force all chunks to be re-embedded
```

The commands report `processed`, `skipped`, `succeeded`, and `failed` counts. They require `OPENAI_API_KEY`; without it they fail before doing work with a clear missing-key message.

Missing-key and recovery behavior:

- Uploads, document previews, and keyword search do not require an OpenAI key.
- When no key is configured, upload-time embedding is skipped and the response reports `embeddingStatus: "skipped_missing_api_key"`.
- If PDF extraction and FTS indexing succeed but embedding generation fails, the document remains `ready`; `failureReason` records that embeddings failed, and `npm run embeddings:backfill` can recover without re-upload.
- Explicit `mode=semantic` or `mode=hybrid` returns a clear error when the key or stored embeddings are missing. Auto mode falls back to keyword unless semantic retrieval is available.

Privacy considerations:

- API keys are read only from environment variables and are never logged.
- Full private document content is not logged by embedding or retrieval helpers.
- Uploaded PDFs, local SQLite databases, extracted data, and embedding artifacts remain ignored by git.

Migration notes:

- New migration: `prisma/migrations/20260710143000_add_chunk_embeddings/migration.sql`.
- The migration creates `DocumentChunkEmbedding` with a unique `chunkId`, model/hash indexes, JSON vector storage, and cascade delete from `DocumentChunk`.
- Run `npx prisma migrate dev` in a healthy Prisma runtime, then `npx prisma generate`.
- In this local runtime, Prisma CLI commands still hang silently; the migration SQL was applied directly to `prisma/quicknotes.dev.db` with `/usr/bin/sqlite3` for verification.

Current limitations:

- Semantic scan is in-process over SQLite rows, so it is intended for local/small datasets.
- Embeddings are stored as JSON vectors, not a vector index.
- Only one embedding row is stored per chunk, so changing models updates that row.
- There is no answer-generation UI or source-grounded prompt flow yet.
- OCR for scanned PDFs is not implemented.

## Development Log Process

After every completed task:

- Update this README with what changed.
- Record the current project status.
- Name the next recommended step.
- Run the relevant checks before committing.
- Commit with a clear message and push to GitHub.

## Development Log

### 2026-07-02

Changed:
- Initialized the QuickNotes Next.js, TypeScript, Tailwind, and ESLint project scaffold.
- Added a first-screen study workspace UI with source, filter, question, answer, citation, and fallback sections.
- Added a `/api/health` route for a minimal backend surface.
- Added shared domain types for study documents, source citations, retrieval modes, and supported answer states.
- Added `.gitignore` rules for dependencies, build output, secrets, PDFs, local databases, uploads, extracted text, and embeddings.

Current status:
- The repository has the initial application shell and project documentation.
- PDF upload, database persistence, text extraction, retrieval, OpenAI integration, and evaluation tests are planned but not implemented yet.
- `npm run lint`, `npm run typecheck`, and `npm run build` pass.
- `npm audit --omit=dev` reports a moderate PostCSS advisory through the current Next.js dependency chain; npm only offers a breaking forced downgrade, so no automated audit fix was applied.

Next recommended step:
- Add the database layer and a real PDF upload endpoint that stores document metadata without committing uploaded files or extracted artifacts.

### 2026-07-04

Changed:
- Added a Prisma + SQLite document ingestion data model with `StudyDocument`, `DocumentPage`, and `DocumentChunk` tables.
- Added local PDF upload storage under ignored `storage/` paths and an ignored local SQLite database.
- Added a PDF upload/list/detail/content API that stores PDFs, extracts page text, chunks text with page/chunk ordering, and records ready/failed status.
- Added a reusable citation-safe chunking utility with lightweight unit tests.
- Replaced the static workspace shell with a document library UI for uploading PDFs, viewing ingestion status, and previewing extracted pages/chunks.
- Updated shared types to align with document API responses and future citation-backed retrieval.

Current status:
- Local deterministic PDF ingestion is implemented.
- Prisma generation and the initial migration are in place.
- `npm run lint`, `npm run typecheck`, and `npm run test:unit` pass in this workspace.
- `npm run build` currently hangs before Next.js emits its build banner in this local runtime after repeated interrupted build attempts; no application TypeScript errors are reported by `npm run typecheck`.
- AI answers, embeddings, OCR, and retrieval search are not implemented yet.
- PDF extraction quality depends on the source PDF text layer.

Next recommended step:
- Build retrieval search over uploaded chunks, starting with keyword/BM25-style search and document filters before adding embeddings.

### 2026-07-10

Changed:
- Added a raw SQLite FTS5 migration for `DocumentChunkSearch`, a rebuildable local search mirror over chunk text.
- Added search/index helpers for FTS table creation, idempotent backfill, document-level sync, full rebuild, query normalization, BM25 ranking, and citation-shaped result mapping.
- Synced uploaded/extracted chunks into the search index after chunk persistence.
- Added `GET /api/search?q=...` with optional `documentId`, `class`, `topic`, `tag`, and `limit` filters.
- Added a workspace search panel with ranked results, document/file/page/chunk context, score display, and a selected source callout.
- Added unit tests proving search returns expected chunk and citation metadata.

Current status:
- Local PDF ingestion remains the source-of-truth path for documents, pages, and chunks.
- Keyword retrieval is implemented for local chunks; AI answers, embeddings, semantic search, OCR, and hybrid ranking are still not implemented.
- `npm run test:unit` passes with 6 tests.
- Direct SQLite FTS smoke test passes and returns the expected chunk with a BM25 score.
- `npm run typecheck` was attempted after fixing the initial test typing errors, but the command remained silent for roughly 3 minutes and was interrupted with no diagnostics.
- `npx prisma generate`, `./node_modules/.bin/prisma generate`, `./node_modules/.bin/prisma --version`, and `./node_modules/.bin/prisma migrate status` each remained silent for about 1 minute and were interrupted. Running Prisma outside the sandbox did not change this behavior.
- `npm run lint` remained silent for about 1 minute after printing the npm script header and was interrupted.
- `npm run build` still hangs before the Next build banner. In this run it printed only:

```text
> quicknotes@0.1.0 build
> next build --webpack
```

Commit:
- `6ba3181` - Added local SQLite FTS chunk search, citation-shaped results, workspace search UI, and retrieval helper tests.

Next recommended step:
- Add embedding-based semantic search and hybrid ranking that combines vector similarity with the existing SQLite BM25 retrieval, then use retrieved chunks for citation-grounded answer generation.

### 2026-07-10 Semantic and hybrid retrieval

Changed:
- Added `OPENAI_API_KEY` and `OPENAI_EMBEDDING_MODEL` configuration with `.env.example`; the default embedding model is `text-embedding-3-small`.
- Added `DocumentChunkEmbedding` with JSON vector storage, dimensions, embedding model, content hash, and timestamps.
- Added an OpenAI embedding service with batching, normalized vectors, response validation, typed errors, and dependency injection for tests.
- Added idempotent upload-time embedding sync, stale/missing/all backfill helpers, and package scripts for embedding backfill and rebuild.
- Added semantic cosine retrieval over stored vectors, hybrid RRF retrieval, deduplication by chunk ID, deterministic tie ordering, and citation-safe metadata preservation.
- Extended `GET /api/search` with `mode=keyword|semantic|hybrid`, semantic availability metadata, default keyword fallback, and explicit missing-key/missing-embedding errors.
- Updated the workspace search UI with Hybrid/Semantic/Keyword modes, ranking metadata, and unavailable states.
- Added vector, semantic retrieval, hybrid fusion, deterministic tie ordering, missing-key, fallback, content-hash, idempotency, and model-change tests.

Current status:
- Keyword search remains fully local and available without an OpenAI key.
- Semantic and hybrid search require an API key and stored embeddings for the configured model.
- Uploads remain recoverable when embedding generation fails; rerun `npm run embeddings:backfill` after fixing configuration.
- AI answer generation is still not implemented.

Verification results:
- `npm run test:unit` passes with 18 tests.
- `npm run typecheck` passes.
- `npm run lint` passes and prints `eslint config ok`.
- `npm run smoke:retrieval` initially failed in the sandbox because `tsx` could not create an IPC pipe under the macOS temp directory; rerunning outside the sandbox passed and showed semantic ranks `chunk_a`, `chunk_c`, `chunk_b` plus hybrid ranks `chunk_a`, `chunk_b`, `chunk_c`.
- `npm run embeddings:backfill` initially hit the same sandbox `tsx` IPC restriction; rerunning outside the sandbox reached the expected missing-key error: `OPENAI_API_KEY is required for embedding generation and semantic search. Add it to your local environment or use keyword search.`
- `npx prisma generate` and `./node_modules/.bin/prisma generate` each stayed silent for about 1 minute and were interrupted; running the local binary outside the sandbox showed the same behavior.
- `./node_modules/.bin/prisma migrate status` stayed silent for about 1 minute and was interrupted; running it outside the sandbox showed the same behavior.
- The embedding migration SQL was applied directly to `prisma/quicknotes.dev.db` with `/usr/bin/sqlite3`, and `.schema DocumentChunkEmbedding` shows the expected table and indexes.
- `npm run build` printed only the npm script header and `next build --webpack`, then stayed silent for about 1 minute and was interrupted.

Next recommended milestone:
- Citation-backed answer generation with retrieved-context validation, source-grounded prompts, inline page citations, and a strict not-found-in-sources fallback.
