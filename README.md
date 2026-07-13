# QuickNotes

QuickNotes is a study app for learning from uploaded course material. Students can upload PDF textbooks, class notes, and study documents, search extracted chunks, and ask questions that are answered only from retrieved source evidence.

The current milestone establishes the production persistence foundation: Supabase-compatible PostgreSQL through Prisma, pgvector-backed semantic retrieval, PostgreSQL full-text keyword retrieval, local PostgreSQL development through Docker Compose, and database/vector validation tooling. Authentication, Supabase Storage, row-level security, deployment, and cloud PDF lifecycle handling are intentionally out of scope for this milestone.

## Why PostgreSQL And pgvector

PostgreSQL is the production database target because Supabase provides managed Postgres, connection pooling, backups, SQL migrations, and a clean path to later storage/auth integration. pgvector keeps embeddings in the same transactional database as documents, pages, chunks, metadata, tags, and citations, which lets QuickNotes apply document filters before vector ranking and avoids loading every stored embedding into application memory.

Keyword retrieval now uses PostgreSQL full-text search over `DocumentChunk.text`. Semantic retrieval uses pgvector cosine distance over `DocumentChunkEmbedding.vector`. Hybrid retrieval preserves Reciprocal Rank Fusion over keyword and semantic ranks.

## Architecture

- Next.js App Router serves the workspace UI and API routes.
- Prisma targets PostgreSQL with `DATABASE_URL` for runtime traffic and `DIRECT_URL` for migrations.
- `prisma.config.ts` loads `.env.local` for Prisma CLI commands without moving secrets into tracked files.
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

3. Set `DATABASE_URL` in `.env.local` to the Supabase transaction-mode pooler connection string for application runtime.
4. Set `DIRECT_URL` in `.env.local` to the Supabase session-mode pooler connection string for Prisma migrations and schema management.
5. Run:

```bash
npx prisma generate
npx prisma migrate deploy
npm run db:validate-vectors
npm run smoke:app
```

The migration also includes `CREATE EXTENSION IF NOT EXISTS vector;` so fresh databases are initialized automatically when the database role has permission.

Supabase's transaction-mode pooler can conflict with prepared statements. Runtime Prisma clients call `withSupabaseTransactionPoolerCompatibility` and add `pgbouncer=true` to Supabase port `6543` URLs when the parameter is not already present. Migration commands use `DIRECT_URL`, which points at the session-mode pooler instead.

## Environment Variables

```bash
DATABASE_URL=postgresql://quicknotes:quicknotes@localhost:54322/quicknotes?schema=public
DIRECT_URL=postgresql://quicknotes:quicknotes@localhost:54322/quicknotes?schema=public

OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_EVAL_MODEL=

# Required only for destructive test databases.
QUICKNOTES_TEST_DATABASE=
QUICKNOTES_ALLOW_DESTRUCTIVE_DB=
```

Without an OpenAI key, uploads, document browsing, and keyword search remain usable. Semantic/hybrid retrieval and answer generation need stored embeddings and a valid OpenAI key. Current live OpenAI answer/eval requests may fail when the configured key lacks billing or model permissions; that external rejection is not treated as an application-code failure.

## Local PostgreSQL Setup

Local development uses PostgreSQL with pgvector so development and production retrieval behavior stay aligned.

```bash
npm install
docker compose up -d postgres
npx prisma generate
npm run db:migrate:dev
npm run dev
```

Useful database commands:

```bash
npx prisma validate
npx prisma format
npm run db:migrate:status
npm run db:migrate:deploy
npm run db:validate-vectors
```

Reset local data only when you do not need the local database contents:

```bash
npm run db:migrate:dev -- --create-only
npx prisma migrate reset
docker compose down -v
docker compose up -d postgres
npm run db:migrate:dev
```

Run destructive commands only against a disposable local database. `scripts/prisma-safe.ts` blocks `prisma migrate reset`, `prisma db push --force-reset`, and `prisma db push --accept-data-loss` unless the target is local or an explicitly marked isolated test database.

There is no seed script yet. Seed local data by uploading PDFs through the app, then run `npm run embeddings:backfill` after OpenAI embedding configuration is available.

## Migration Details

This milestone replaces the active SQLite migration history with PostgreSQL baseline migration `20260713090000_postgres_pgvector_foundation`.

Active Prisma migrations live in `prisma/migrations` and are PostgreSQL-only. The previous SQLite migration SQL is preserved under `prisma/sqlite-migration-archive` for reference and must not be run against PostgreSQL.

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

The inspected local SQLite database at `prisma/quicknotes.dev.db` contained zero `StudyDocument`, `DocumentPage`, `DocumentChunk`, `DocumentChunkEmbedding`, `Tag`, and `DocumentTag` rows, so no local application data was imported. The file is ignored by Git and intentionally left behind for local reference.

For future local SQLite data, keep a backup of the old SQLite database and uploaded PDF directory before switching. Dry-run the transfer first:

```bash
npm run db:transfer:sqlite -- --dry-run
```

Apply only when the target is the intended PostgreSQL database:

```bash
npm run db:transfer:sqlite -- --apply
```

The transfer script preserves document, page, chunk, tag, document-tag, date, and compatible embedding relationships by original IDs. It is idempotent through `skipDuplicates` and `ON CONFLICT DO NOTHING`, and it never deletes PostgreSQL/Supabase rows. It copies database rows only; it does not upload locally stored PDFs to production storage.

After transfer, run:

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

Rollback is source-controlled for application code and migration files. For Supabase data, use Supabase backups or point-in-time recovery to restore the database to the pre-migration state. Do not use `prisma migrate resolve` to mark migrations applied unless the live schema has been verified to match the migration exactly.

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
npm run test:db-safety
npm run test:integration
npm run eval:offline
npm run smoke:app
npm run smoke:retrieval
npm run smoke:answer
npm run eval:live
npm run build
npm run db:validate-vectors
```

`smoke:answer` and `eval:live` require a valid OpenAI key with billing/model access. If OpenAI rejects the request for billing or permissions, keep the failure documented and do not weaken production behavior with mocks.

`test:unit` does not use Supabase. `test:integration` first runs `scripts/test-database-guard.ts`; it fails closed when `DATABASE_URL` points at a non-test Supabase database.

## Development Log

July 13, 2026:

- Moved Prisma from SQLite to PostgreSQL with `DATABASE_URL` and `DIRECT_URL`.
- Added a PostgreSQL baseline migration with pgvector, vector index, full-text index, and all document/page/chunk/metadata/tag relationships.
- Replaced JSON embedding persistence with validated pgvector writes.
- Moved semantic ranking into PostgreSQL/pgvector SQL.
- Kept keyword, semantic, and hybrid retrieval modes with deterministic tie ordering and existing RRF behavior.
- Added Docker Compose local PostgreSQL/pgvector setup.
- Added idempotent embedding backfill and database/vector validation tooling.
- Added Prisma CLI `.env.local` loading through `prisma.config.ts`.
- Archived the SQLite migration SQL outside the active Prisma migration path.
- Added Supabase-safe migration/test guards and a dry-run SQLite-to-PostgreSQL transfer script.
- Added a route-level application smoke script for Supabase-backed upload, metadata, search, answer, and embedding checks.
- Updated unit tests and offline fixtures for the new database-backed retrieval contract.

## Current Verification

Verified on July 13, 2026:

- `npx prisma format`: passed
- `npx prisma validate`: passed
- `npx prisma generate`: passed
- `npx prisma migrate status`: passed against Supabase after deploy; database schema is up to date
- `npx prisma migrate deploy`: passed; applied `20260713090000_postgres_pgvector_foundation`
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run test:unit`: passed, 60 tests
- `npm run test:db-safety`: passed
- `npm run test:integration`: blocked by design because `.env.local` points at a non-test Supabase database
- `npm run eval:offline`: passed, all tracked rates 1.000
- `npm run smoke:retrieval`: passed
- `npm run smoke:app`: passed against Supabase route handlers; uploaded and ingested a PDF, listed/read/updated it, verified keyword/semantic/hybrid filtered search, verified insufficient-evidence answer behavior, and validated fresh embeddings
- `npm run build`: passed with `next build --webpack`
- `npm run db:validate-vectors`: passed against Supabase
- `npm run smoke:answer`: OpenAI rejected the configured request; non-secret error: `OpenAI rejected the answer request. Check OPENAI_API_KEY permissions and billing access.`
- `npm run eval:live`: same OpenAI billing/permission rejection
- `npm run dev` and `npm run start` did not bind to localhost in the Codex execution environment; route-handler smoke covered the application API paths directly

Package scripts use `node --import tsx` instead of the `tsx` CLI so scripts can run in the Codex sandbox without the `listen EPERM` IPC failure.

## Current Limitations

- `DocumentChunkEmbedding.vector` is fixed at `vector(1536)`; changing embedding dimensions requires a schema migration and full embedding rebuild.
- Only one embedding row is stored per chunk.
- Local PDF storage is still filesystem-based.
- OCR for scanned PDFs is not implemented.
- Authentication, Supabase Storage, row-level security, deployment, and cloud document lifecycle handling are not implemented in this milestone.
- Live answer/eval verification depends on a working OpenAI key with billing/model access.

## Recommended Next Milestone

Cloud PDF storage using Supabase Storage, with durable upload, deletion, and document lifecycle handling.
