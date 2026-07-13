# QuickNotes

QuickNotes is a study app for learning from uploaded course material. Students can upload PDF textbooks, class notes, and study documents, search extracted chunks, and ask questions that are answered only from retrieved source evidence.

The current milestone establishes the production persistence foundation: Supabase-compatible PostgreSQL through Prisma, pgvector-backed semantic retrieval, PostgreSQL full-text keyword retrieval, local PostgreSQL development through Docker Compose, and database/vector validation tooling. Authentication, Supabase Storage, row-level security, deployment, and cloud PDF lifecycle handling are intentionally out of scope for this milestone.

## Why PostgreSQL And pgvector

PostgreSQL is the production database target because Supabase provides managed Postgres, connection pooling, backups, SQL migrations, and a clean path to later storage/auth integration. pgvector keeps embeddings in the same transactional database as documents, pages, chunks, metadata, tags, and citations, which lets QuickNotes apply document filters before vector ranking and avoids loading every stored embedding into application memory.

Keyword retrieval now uses PostgreSQL full-text search over `DocumentChunk.text`. Semantic retrieval uses pgvector cosine distance over `DocumentChunkEmbedding.vector`. Hybrid retrieval preserves Reciprocal Rank Fusion over keyword and semantic ranks.

## Architecture

- Next.js App Router serves the workspace UI and API routes.
- Prisma targets PostgreSQL with `DATABASE_URL` for runtime traffic and `DIRECT_URL` for migrations.
- `StudyDocument`, `DocumentPage`, `DocumentChunk`, `DocumentChunkEmbedding`, `Tag`, and `DocumentTag` are stored in PostgreSQL.
- `DocumentChunkEmbedding.vector` is a `vector(1536)` pgvector column. `OPENAI_EMBEDDING_DIMENSIONS` must match that column.
- `pdfjs-dist` extracts PDF text layers.
- Local PDF files remain on disk for this milestone.
- Metadata filters are applied inside SQL before keyword, semantic, or hybrid candidate selection.
- Answer generation reuses the same retrieval helpers and never runs a separate unfiltered retrieval path.
- OpenAI calls are isolated in server-side services under `src/lib/server/`.

## Supabase Setup

1. Create a Supabase project.
2. Enable pgvector in the SQL editor if it is not already enabled:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

3. Set `DATABASE_URL` to the pooled Supabase connection string for application runtime.
4. Set `DIRECT_URL` to the direct Supabase PostgreSQL connection string for Prisma migrations.
5. Run:

```bash
npx prisma generate
npx prisma migrate deploy
npm run db:validate-vectors
```

The migration also includes `CREATE EXTENSION IF NOT EXISTS vector;` so fresh databases are initialized automatically when the database role has permission.

## Environment Variables

```bash
DATABASE_URL=postgresql://quicknotes:quicknotes@localhost:54322/quicknotes?schema=public
DIRECT_URL=postgresql://quicknotes:quicknotes@localhost:54322/quicknotes?schema=public

OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_EVAL_MODEL=
```

Without an OpenAI key, uploads, document browsing, and keyword search remain usable. Semantic/hybrid retrieval and answer generation need stored embeddings and a valid OpenAI key. Current live OpenAI answer/eval requests may fail when the configured key lacks billing or model permissions; that external rejection is not treated as an application-code failure.

## Local PostgreSQL Setup

Local development uses PostgreSQL with pgvector so development and production retrieval behavior stay aligned.

```bash
npm install
docker compose up -d postgres
npx prisma generate
npx prisma migrate dev
npm run dev
```

Useful database commands:

```bash
npx prisma validate
npx prisma format
npx prisma migrate status
npx prisma migrate deploy
npm run db:validate-vectors
```

Reset local data only when you do not need the local database contents:

```bash
npx prisma migrate reset
docker compose down -v
docker compose up -d postgres
npx prisma migrate dev
```

There is no seed script yet. Seed local data by uploading PDFs through the app, then run `npm run embeddings:backfill` after OpenAI embedding configuration is available.

## Migration Details

This milestone replaces the SQLite migration history with PostgreSQL baseline migration `20260713090000_postgres_pgvector_foundation`.

The PostgreSQL schema preserves:

- Document IDs and stored PDF filenames
- Page IDs, page numbers, and page text
- Chunk IDs, page numbers, chunk indexes, and source text
- Upload status, failure reason, page counts, and timestamps
- Class, topic, source, date, legacy JSON tag cache, normalized tags, and document-tag links
- Citation-safe chunk IDs and source text

The embedding storage migration changes `DocumentChunkEmbedding` from JSON text storage to:

- `embeddingModel`
- `dimensions`
- `vector vector(1536)`
- `contentHash`
- timestamps and chunk relationship

For existing local SQLite data, keep a backup of the old SQLite database and uploaded PDF directory before switching. Import rows into PostgreSQL with their original `id`, `documentId`, page numbers, chunk indexes, metadata fields, and tag links intact, then run:

```bash
npm run embeddings:backfill
npm run db:validate-vectors
```

The backfill script is idempotent. It skips fresh embeddings, can fill only missing embeddings, and can rebuild all embeddings:

```bash
npm run embeddings:backfill
npm run embeddings:missing
npm run embeddings:rebuild
```

## Retrieval Semantics

Shared retrieval filters are used by keyword, semantic, hybrid, and answer retrieval:

```ts
type RetrievalFilters = {
  documentIds?: string[];
  classNames?: string[];
  topics?: string[];
  sources?: string[];
  tags?: string[];
  documentDateFrom?: string;
  documentDateTo?: string;
};
```

- Multiple values within one category use OR semantics.
- Different categories use AND semantics.
- Multiple selected tags use match-any semantics.
- Tags match by normalized case-insensitive name.
- `documentDateFrom` and `documentDateTo` are inclusive `YYYY-MM-DD` boundaries.
- Empty values are discarded during normalization.
- Invalid dates or reversed date ranges are rejected.
- Filtered-out chunks cannot influence ranking, answer context, or citations.
- Semantic ties are ordered deterministically by document ID, page number, chunk index, and chunk ID.

## APIs

Search:

```text
GET /api/search?q=regression&mode=hybrid&className=Data%20Analytics&tag=exam-2
```

Answer:

```text
POST /api/answer
Content-Type: application/json
```

```json
{
  "question": "What assumptions are required for linear regression?",
  "mode": "hybrid",
  "topK": 8,
  "filters": {
    "classNames": ["Data Analytics"],
    "topics": ["Regression"],
    "tags": ["exam-2"]
  }
}
```

If filtered retrieval finds no usable chunks, QuickNotes returns:

```text
I couldn't find enough information in the selected sources to answer that question.
```

## Validation

Database/vector validation reports:

- document count
- page count
- chunk count
- embedding count
- missing embeddings
- stale embeddings
- vectors with invalid dimensions
- duplicate chunks

Run:

```bash
npm run db:validate-vectors
```

The script loads `.env.local` through the shared script environment helper and fails with actionable errors when `DATABASE_URL`, `DIRECT_URL`, or required embedding configuration is missing. It exits nonzero when missing, stale, invalid-dimension, or duplicate chunk problems are found.

## Citation And Grounding

Generated answers cite sources with stable markers such as `[1]`. The model returns structured claims with citation IDs; the server validates IDs and appends visible markers itself.

Prompt-injection defenses remain in place:

- Source chunks are serialized as untrusted JSON data.
- System instructions require using only supplied `SOURCE_CHUNKS`.
- Commands or role changes inside PDFs are ignored.
- Excluded documents never reach answer context.
- The browser never receives `OPENAI_API_KEY`.

## Tests And Evaluation

```bash
npx prisma format
npx prisma validate
npx prisma generate
npx prisma migrate status
npm run typecheck
npm run lint
npm run test:unit
npm run eval:offline
npm run smoke:retrieval
npm run smoke:answer
npm run eval:live
npm run build
npm run db:validate-vectors
```

`smoke:answer` and `eval:live` require a valid OpenAI key with billing/model access. If OpenAI rejects the request for billing or permissions, keep the failure documented and do not weaken production behavior with mocks.

## Development Log

July 13, 2026:

- Moved Prisma from SQLite to PostgreSQL with `DATABASE_URL` and `DIRECT_URL`.
- Added a PostgreSQL baseline migration with pgvector, vector index, full-text index, and all document/page/chunk/metadata/tag relationships.
- Replaced JSON embedding persistence with validated pgvector writes.
- Moved semantic ranking into PostgreSQL/pgvector SQL.
- Kept keyword, semantic, and hybrid retrieval modes with deterministic tie ordering and existing RRF behavior.
- Added Docker Compose local PostgreSQL/pgvector setup.
- Added idempotent embedding backfill and database/vector validation tooling.
- Updated unit tests and offline fixtures for the new database-backed retrieval contract.

## Current Verification

Verified on July 13, 2026:

- `npx prisma format`: passed
- `npx prisma validate`: passed
- `npx prisma generate`: passed
- `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`: passed
- `npx prisma migrate status`: blocked because no local PostgreSQL server is reachable at `localhost:54322`; `docker compose up -d postgres` also failed because `docker` is not installed in this environment
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run test:unit`: passed, 56 tests
- `npm run eval:offline`: passed, all tracked rates 1.000
- `npm run smoke:retrieval`: passed
- `npm run build`: passed with `next build --webpack`
- `npm run db:validate-vectors`: blocked because no local PostgreSQL server is reachable at `localhost:54322`
- `npm run smoke:answer`: OpenAI rejected the configured request; non-secret error: `OpenAI rejected the answer request. Check OPENAI_API_KEY permissions and billing access.`
- `npm run eval:live`: same OpenAI billing/permission rejection

In the Codex sandbox, `tsx` commands can fail to create their local IPC pipe with `listen EPERM`; rerunning those commands outside the sandbox resolves that local runner issue.

## Current Limitations

- `DocumentChunkEmbedding.vector` is fixed at `vector(1536)`; changing embedding dimensions requires a schema migration and full embedding rebuild.
- Only one embedding row is stored per chunk.
- Local PDF storage is still filesystem-based.
- OCR for scanned PDFs is not implemented.
- Authentication, Supabase Storage, row-level security, deployment, and cloud document lifecycle handling are not implemented in this milestone.
- Live answer/eval verification depends on a working OpenAI key with billing/model access.

## Recommended Next Milestone

Cloud PDF storage using Supabase Storage, with durable upload, deletion, and document lifecycle handling.
