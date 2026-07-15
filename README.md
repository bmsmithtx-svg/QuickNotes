# QuickNotes

QuickNotes is a study app for learning from uploaded course material. Students can upload PDF textbooks, class notes, and study documents, search extracted chunks, and ask questions that are answered only from retrieved source evidence.

The current milestone extends the production persistence foundation with durable PDF source storage and Vercel deployment readiness. Supabase-compatible PostgreSQL through Prisma remains the database of record, pgvector backs semantic retrieval, PostgreSQL full-text search backs keyword retrieval, and uploaded PDF source files can now be stored in a private Supabase Storage bucket. Authentication, row-level security, payments, and collaborative accounts remain out of scope; use deployment protection for non-local deployments until an auth milestone is added.

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
- PDF source storage is accessed through a server-side adapter. `QUICKNOTES_STORAGE_PROVIDER=local` keeps local filesystem development; `QUICKNOTES_STORAGE_PROVIDER=supabase` stores source PDFs in a private Supabase Storage bucket with the service-role key used only on the server.
- Source PDFs use collision-resistant object keys under `documents/`. Original filenames are stored separately for display and citations.
- Document lifecycle states are `UPLOADING`, `PROCESSING`, `READY`, `FAILED`, and `DELETING`.
- Production env validation is available through `npm run smoke:production`; it fails closed for local database URLs, local PDF storage, missing OpenAI/Supabase variables, invalid embedding dimensions, or leaked `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`.
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
5. Create a private Supabase Storage bucket for PDFs, or let the app create it with the service-role key:

```bash
QUICKNOTES_STORAGE_PROVIDER=supabase npm run storage:ensure-bucket
```

6. Run:

```bash
npx prisma generate
npx prisma migrate deploy
npm run db:validate-vectors
npm run smoke:app
npm run smoke:production
```

The migration also includes `CREATE EXTENSION IF NOT EXISTS vector;` so fresh databases are initialized automatically when the database role has permission.

Supabase's transaction-mode pooler can conflict with prepared statements. Runtime Prisma clients call `withSupabaseTransactionPoolerCompatibility` and add `pgbouncer=true` to Supabase port `6543` URLs when the parameter is not already present. Migration commands use `DIRECT_URL`, which points at the session-mode pooler instead.

For production, `DATABASE_URL` must be the Supabase transaction-mode pooler on port `6543`, and `DIRECT_URL` must be the session-mode pooler or direct migration connection. Do not use the local Docker database for a Vercel deployment.

## Environment Variables

```bash
DATABASE_URL=postgresql://quicknotes:quicknotes@localhost:54322/quicknotes?schema=public
DIRECT_URL=postgresql://quicknotes:quicknotes@localhost:54322/quicknotes?schema=public

OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
OPENAI_CHAT_MODEL=gpt-5-mini
OPENAI_EVAL_MODEL=

QUICKNOTES_STORAGE_PROVIDER=local
QUICKNOTES_LOCAL_STORAGE_ROOT=
QUICKNOTES_LOCAL_STORAGE_BUCKET=local
QUICKNOTES_MAX_PDF_UPLOAD_BYTES=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=quicknotes-pdfs

# Required only for destructive test databases.
QUICKNOTES_TEST_DATABASE=
QUICKNOTES_ALLOW_DESTRUCTIVE_DB=
```

Without an OpenAI key, uploads, document browsing, and keyword search remain usable. Semantic/hybrid retrieval and answer generation need stored embeddings and a valid OpenAI key. Current live OpenAI answer/eval requests may fail when the configured key lacks billing or model permissions; that external rejection is not treated as an application-code failure.

Production requires `DATABASE_URL`, `DIRECT_URL`, `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_DIMENSIONS`, `OPENAI_CHAT_MODEL`, `QUICKNOTES_STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`. `SUPABASE_SERVICE_ROLE_KEY` is server-only. Do not create `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`; the application rejects that configuration so the service-role credential is not exposed to browser code.

`QUICKNOTES_MAX_PDF_UPLOAD_BYTES` is optional. The upload route defaults to 25 MB outside Vercel and 4 MB on Vercel to stay below the platform request body limit. Larger production PDFs need a direct-to-storage upload workflow before raising this limit on Vercel.

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

Useful storage commands:

```bash
npm run storage:ensure-bucket
npm run storage:migrate-local
npm run storage:reconcile
npm run storage:reconcile -- --verify-checksums
npm run storage:retry -- <documentId>
```

`storage:reconcile` is report-only. Destructive orphan cleanup is not implemented.

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

## Vercel Deployment

Set these Vercel environment variables for Production and Preview as appropriate:

- `DATABASE_URL`: Supabase transaction-mode pooler on port `6543`
- `DIRECT_URL`: Supabase session-mode pooler or direct migration connection
- `OPENAI_API_KEY`
- `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`
- `OPENAI_EMBEDDING_DIMENSIONS=1536`
- `OPENAI_CHAT_MODEL=gpt-5-mini`
- `QUICKNOTES_STORAGE_PROVIDER=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET=quicknotes-pdfs`
- Optional `QUICKNOTES_MAX_PDF_UPLOAD_BYTES`, kept below Vercel's function request body limit

Do not set `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`.

The `build` script runs `prisma generate` before `next build --webpack`, so Vercel generates Prisma Client during deployment. Run migrations before or during deployment with:

```bash
npm run db:migrate:deploy
```

Then verify the deployment environment from a trusted machine or CI runner with:

```bash
npm run storage:ensure-bucket
npm run smoke:production
```

All API routes that touch Prisma, PDF parsing, storage, embeddings, or OpenAI use the Node.js runtime. Upload, retry, and answer routes set `maxDuration = 300`.

The current direct upload route receives the PDF through the Next.js route handler before storing it in Supabase Storage. On Vercel, this path is limited by the function request body limit, so production uploads default to 4 MB. Larger textbooks require a future direct browser-to-Supabase upload flow followed by server-side processing from the private object.

Until application authentication is implemented, do not expose an unprotected production deployment to the public internet. Use Vercel Deployment Protection, an internal network, or equivalent access control so document list/detail/source routes are not publicly reachable.

## Migration Details

This milestone replaces the active SQLite migration history with PostgreSQL baseline migration `20260713090000_postgres_pgvector_foundation`.

Active Prisma migrations live in `prisma/migrations` and are PostgreSQL-only. The previous SQLite migration SQL is preserved under `prisma/sqlite-migration-archive` for reference and must not be run against PostgreSQL.

`20260713120000_supabase_storage_lifecycle` adds durable source-storage metadata, content checksums, lifecycle diagnostics, processing attempt counts, and timestamp fields. Existing rows are backfilled as local-storage records with `storageObjectKey = storedFileName`, and legacy lowercase statuses are normalized to the lifecycle states.

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

The transfer script preserves document, page, chunk, tag, document-tag, date, and compatible embedding relationships by original IDs. It is idempotent through `skipDuplicates` and `ON CONFLICT DO NOTHING`, and it never deletes PostgreSQL/Supabase rows. It copies database rows only; use `npm run storage:migrate-local` to upload eligible local source PDFs to Supabase Storage afterward.

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

Source PDF:

```text
GET /api/documents/:id/source
```

Supabase-backed documents redirect to a short-lived signed URL. Local documents stream through the server.

Retry processing:

```text
POST /api/documents/:id/retry
```

Deletion:

```text
DELETE /api/documents/:id
```

Deletion first marks the document `DELETING`, which excludes it from retrieval, then deletes the stored source PDF and finally deletes the database row with cascading relationships.

## Durable Storage Lifecycle

Upload flow:

1. Validate the uploaded PDF.
2. Reserve a `StudyDocument` row in `UPLOADING`.
3. Upload the original PDF through the configured storage adapter.
4. Persist storage provider, bucket, object key, content checksum, MIME type, and size.
5. Transition to `PROCESSING`.
6. Read the PDF back through the storage adapter.
7. Extract pages, create chunks, sync metadata, and generate embeddings through the existing embedding pipeline.
8. Mark the document `READY`.

If processing fails, QuickNotes marks the document `FAILED`, stores a sanitized failure stage and message, removes derived pages/chunks/embeddings when safe, and keeps the source PDF for retry. `npm run storage:retry -- <documentId>` and `POST /api/documents/:id/retry` reuse the stored PDF and clear derived rows first, so reruns do not duplicate chunks or embeddings.

## Local PDF Migration

`npm run storage:migrate-local` finds documents whose source PDFs are still local, uploads eligible files to the configured Supabase bucket, verifies the uploaded object exists, and updates storage metadata only after verification. It skips already migrated documents, reports missing local files, supports safe reruns, and never deletes local files automatically.

## Storage Reconciliation

`npm run storage:reconcile` reports:

- database documents whose storage object is missing
- storage objects under `documents/` with no matching database row
- documents stuck in `UPLOADING`, `PROCESSING`, or `DELETING`
- failed documents eligible for retry
- missing storage metadata
- optional checksum and file-size mismatches with `-- --verify-checksums`

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

Production persistence smoke test:

```bash
npm run smoke:production
```

This command requires the production Supabase/OpenAI variables listed above. It validates the environment without printing secrets, verifies database connectivity, verifies the Supabase Storage bucket is private, uploads a generated PDF through the application pipeline, confirms the source object exists, confirms embeddings were persisted for the new chunks, runs keyword/semantic/hybrid retrieval against the persisted document, generates a citation-backed hybrid answer, verifies citations point back to the persisted source text, deletes the document through the API, and verifies the database row and PDF object are gone.

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
npm run smoke:production
npm run build
npm run db:validate-vectors
```

`smoke:answer` and `eval:live` require a valid OpenAI key with billing/model access. If OpenAI rejects the request for billing or permissions, keep the failure documented and do not weaken production behavior with mocks.

`smoke:production` additionally requires Supabase PostgreSQL, private Supabase Storage, and OpenAI credentials. It creates and deletes one smoke document. Do not run it against a database where temporary smoke rows are unacceptable.

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
- Added private Supabase Storage support behind a server-side storage abstraction, durable document lifecycle states, source PDF preview/download, retry-safe processing, deletion, local migration, and reconciliation tooling.

July 15, 2026:

- Added production environment validation for Supabase PostgreSQL, private Supabase Storage, OpenAI embedding/answer models, and server-only service-role credentials.
- Added `npm run smoke:production` to verify database connectivity, private storage, upload processing, persisted embeddings, retrieval, citation-backed answers, and cascading source/document deletion without logging secrets.
- Made `npm run build` generate Prisma Client before `next build --webpack`.
- Added Vercel route duration hints and a Vercel-safe default upload limit with `QUICKNOTES_MAX_PDF_UPLOAD_BYTES` override.
- Documented Supabase/Vercel setup, production smoke testing, and the access-control requirement for deployments without app authentication.

## Current Verification

Verified on July 15, 2026:

- `npx prisma validate`: passed
- Production environment validation: passed without printing configured values
- `npx prisma migrate status`: passed against Supabase with 2 migrations; database schema is up to date
- `npm run db:migrate:deploy`: passed against Supabase; no pending migrations
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run test:unit`: passed, 84 tests
- `npm run test:db-safety`: passed
- `npm run test:integration`: blocked by design because `.env.local` points at a non-test Supabase database
- `npm run eval:offline`: passed, all tracked rates 1.000
- `npm run smoke:retrieval`: passed
- `npm run smoke:answer`: passed with configured OpenAI credentials after network access was allowed
- `npm run eval:live`: passed with 1.000 retrieval, citation, prompt-injection, grounded-claim, and fully grounded-answer rates using `gpt-5-mini` after network access was allowed
- `npm run db:validate-vectors`: passed against Supabase; 3 documents, 2 pages, 2 chunks, 2 embeddings, no missing/stale/invalid/duplicate vectors
- `npm run build`: passed with Prisma generation followed by `next build --webpack`
- `QUICKNOTES_STORAGE_PROVIDER=supabase npm run storage:ensure-bucket`: passed against private Supabase Storage; bucket existed and was not public
- `QUICKNOTES_STORAGE_PROVIDER=supabase npm run smoke:production`: passed; verified PDF upload through the application route, private Supabase Storage persistence, PostgreSQL document/page/chunk/embedding persistence, pgvector retrieval, citation-grounded answer generation, signed source PDF access without service-role key exposure, document/storage deletion, and smoke-data cleanup
- `npm run smoke:app`: not rerun in this verification pass to avoid adding local-storage smoke rows to the Supabase database
- `npm run dev` and `npm run start`: not rerun in this verification pass

Package scripts use `node --import tsx` instead of the `tsx` CLI so scripts can run in the Codex sandbox without the `listen EPERM` IPC failure.

## Current Limitations

- `DocumentChunkEmbedding.vector` is fixed at `vector(1536)`; changing embedding dimensions requires a schema migration and full embedding rebuild.
- Only one embedding row is stored per chunk.
- Local filesystem PDF storage remains available for development through `QUICKNOTES_STORAGE_PROVIDER=local`.
- Vercel direct route uploads default to 4 MB because the PDF currently passes through a function request body before Supabase Storage. Larger PDFs require a future direct-to-storage upload flow.
- OCR for scanned PDFs is not implemented.
- Application authentication and row-level security are not implemented in this milestone. Use Vercel Deployment Protection or equivalent access control before exposing a deployment with real documents.
- Live answer/eval verification depends on a working OpenAI key with billing/model access.

## Recommended Next Milestone

Authentication, authorization, and row-level security for multi-user document libraries.
