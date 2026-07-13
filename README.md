# QuickNotes

QuickNotes is a local-first study app for learning from uploaded course material. Students can upload PDF textbooks, class notes, and study documents, search extracted chunks, and ask questions that are answered only from retrieved source evidence.

The current milestone adds document metadata management and end-to-end filtered RAG. QuickNotes still uses Next.js, Prisma, SQLite, SQLite FTS5, local JSON-stored embeddings, and OpenAI for embedding and answer generation when a server-side API key is configured.

## Architecture

- Next.js App Router serves the workspace UI and API routes.
- Prisma with local SQLite stores documents, metadata, extracted pages, chunks, FTS data, embeddings, and normalized tags.
- `pdfjs-dist` extracts PDF text layers.
- SQLite FTS5 powers keyword retrieval through `DocumentChunkSearch`.
- `DocumentChunkEmbedding` stores normalized OpenAI embedding vectors as JSON for local semantic scans.
- Hybrid retrieval combines keyword and semantic candidates with Reciprocal Rank Fusion.
- Answer generation reuses the same retrieval helpers and never runs a separate unfiltered retrieval path.
- OpenAI calls are isolated in server-side services under `src/lib/server/`.

## Metadata

Each document can store:

- `className`: optional string
- `topic`: optional string
- `source`: optional string
- `documentDate`: optional `YYYY-MM-DD` date
- `tags`: zero or more normalized tags

Metadata normalization trims whitespace and stores empty strings as `null`. Tags are stored in normalized `Tag` and `DocumentTag` tables with a case-insensitive `normalizedName`, while the existing `StudyDocument.tags` JSON column is retained only as a compatibility cache. Duplicate tags on the same document are prevented by the `DocumentTag` primary key.

## Filter Semantics

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
- If filters match no documents or no chunks, retrieval returns no chunks; it does not fall back to unfiltered retrieval.

## Metadata APIs

Update document metadata:

```text
PATCH /api/documents/:id
Content-Type: application/json
```

```json
{
  "className": "Data Analytics",
  "topic": "Regression",
  "source": "Course Textbook",
  "documentDate": "2026-07-12",
  "tags": ["statistics", "exam-2"]
}
```

The endpoint validates input, returns `400` for invalid payloads, `404` for missing documents, and updates tags transactionally without touching pages, chunks, embeddings, or FTS records.

Metadata options:

```text
GET /api/documents/metadata-options
```

Returns deterministic distinct values and document counts for classes, topics, sources, and tags:

```json
{
  "classes": [{ "value": "Data Analytics", "count": 2 }],
  "topics": [{ "value": "Regression", "count": 3 }],
  "sources": [{ "value": "Course Textbook", "count": 1 }],
  "tags": [{ "value": "exam-2", "count": 1 }]
}
```

## Search API

```text
GET /api/search?q=regression&mode=hybrid&className=Data%20Analytics&tag=exam-2
```

Supported filters can be sent as repeated query parameters or comma-separated values:

```text
documentId=<id>
className=<class>
class=<class>          # backward-compatible alias
topic=<topic>
source=<source>
tag=<tag>
documentDateFrom=2026-07-01
documentDateTo=2026-07-31
limit=<1-50>
mode=<keyword|semantic|hybrid>
```

The response includes `filters`, `requestedMode`, `actualMode`, ranking formula metadata, and ranked chunks with citation-safe source text.

## Answer API

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

The legacy top-level `documentIds` field is still accepted and merged into `filters.documentIds` internally. The response includes `filters` so clients can show the applied scope. Only chunks that pass server-side filters can be passed to the model, cited, or returned as retrieved chunks.

If filtered retrieval finds no usable chunks, QuickNotes returns:

```text
I couldn't find enough information in the selected sources to answer that question.
```

## Workspace UI

The workspace includes:

- PDF upload with title, class, topic, source, date, and tag fields
- Document list and extracted page/chunk preview
- Editable metadata panel for class, topic, source, document date, and tags
- Save/loading/error/success state for metadata edits
- Duplicate-aware tag entry with normalized tag preview
- Shared filter panel for documents, classes, topics, sources, tags, and date range
- Clear-all filter action and active-scope chips
- Search and Ask QuickNotes using the same filters
- Filter-aware empty states for overly restrictive scopes
- Citation-backed answer display with clickable source reveals

## Environment Variables

```bash
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_EVAL_MODEL=
```

Without an API key, uploads, document browsing, and keyword search remain usable. Semantic/hybrid retrieval and answer generation need embeddings and a valid OpenAI key.

## Local Setup

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

For a fresh local development database, `npx prisma migrate dev` is also fine. Runtime data is ignored by git, including uploaded PDFs, SQLite databases, journals, `.env*` files except `.env.example`, and build output.

## Migration Notes

This milestone adds migration `20260712173000_add_document_metadata_filters`:

- Adds `StudyDocument.source`
- Adds `StudyDocument.documentDate`
- Adds metadata indexes for class, topic, source, and document date
- Adds `Tag`
- Adds `DocumentTag`
- Backfills existing JSON tags into normalized tag rows

If a local SQLite database was manually changed before migrations were recorded, repair only the local migration history after confirming the schema objects already exist. Do not reset a database with user data.

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
```

Offline fixtures now include:

- Similar regression terminology in different classes
- Shared regression topic with different tags
- A class-filter-dependent answer case
- A tag-filter-dependent answer case
- A no-match filtered case

`eval:offline` reports retrieval metrics and citation correctness separately. `smoke:answer` and `eval:live` require a valid OpenAI key with billing/model access.

## Current Verification

Verified on July 13, 2026:

- `npx prisma generate`: passed
- `npx prisma migrate status`: database schema up to date
- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run test:unit`: passed, 51 tests
- `npm run eval:offline`: passed, all tracked rates 1.000
- `npm run smoke:retrieval`: passed
- `npm run smoke:answer`: OpenAI rejected the configured request; non-secret error: `OpenAI rejected the answer request. Check OPENAI_API_KEY permissions and billing access.`
- `npm run eval:live`: same OpenAI rejection
- `npm run build`: passed with `next build --webpack`

In the Codex sandbox, `tsx` commands may fail to create their local IPC pipe with `listen EPERM`; rerunning those commands outside the sandbox resolves that local runner issue.

## Limitations

- Semantic retrieval scans JSON vectors in-process and is intended for local or small datasets.
- Embeddings are stored as JSON, not in a vector index.
- Only one embedding row is stored per chunk.
- OCR for scanned PDFs is not implemented.
- No authentication, cloud file storage, managed database, hosted vector store, or deployment configuration is implemented in this milestone.
- Live answer/eval verification depends on a working OpenAI key with billing/model access.

## Recommended Next Milestone

Production persistence and deployment readiness, including managed PostgreSQL/vector storage, cloud file storage, authentication, and deployment configuration.
