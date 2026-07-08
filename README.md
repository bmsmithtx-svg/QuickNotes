# QuickNotes

QuickNotes is a school-focused AI study app for learning from uploaded course material. The product goal is to let students upload PDF textbooks, class notes, and study documents, then ask questions and receive answers backed by citations from the source material.

The long-term system will ingest PDFs, chunk and embed document text, perform hybrid semantic and keyword retrieval, and generate source-grounded answers with file and page references plus hallucination fallback controls.

The app is being built as a resume-quality AI knowledge system, not a tutorial clone. The first version starts with a clean Next.js foundation and a product-shaped workspace so the document ingestion, retrieval, citation, and evaluation layers can be added without rewriting the app.

## Planned Features

- Upload PDF textbooks, class notes, and study documents.
- Extract text from PDFs and store document metadata.
- Answer questions with citation-backed evidence that includes file name, page number, and exact source chunk.
- Fall back to "not found in sources" when uploaded material does not support an answer.
- Add hybrid retrieval with semantic/vector search plus keyword/BM25-style search.
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
- `pdfjs-dist` for local text-layer PDF extraction
- OpenAI API planned for embeddings and answer generation

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

Run checks:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Do not commit local secrets, PDFs, databases, extracted chunks, embeddings, or generated document artifacts. The `.gitignore` is set up to keep those files out of git.

Local development data:

- Uploaded PDFs are stored under `storage/uploads/`.
- Extracted/generated local data can live under `storage/extracted/`.
- The local SQLite database is `prisma/quicknotes.dev.db`.
- SQLite journals, uploaded PDFs, storage folders, cache files, build output, and environment files are intentionally ignored by git.

PDF extraction is deterministic and local. It reads the embedded PDF text layer by page; scanned/image-only PDFs will need OCR later.

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
