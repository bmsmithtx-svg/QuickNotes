# QuickNotes

QuickNotes is a school-focused AI study app for learning from uploaded course material. The product goal is to let students upload PDF textbooks, class notes, and study documents, then ask questions and receive answers backed by citations from the source material.

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
- SQLite or Postgres with Prisma planned for the document metadata and chunk store
- OpenAI API planned for embeddings and answer generation

## Current Structure

```text
src/app/              Next.js app routes and API routes
src/components/       Reusable UI components
src/lib/              Shared product types and starter data
```

## Local Setup

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Run checks:

```bash
npm run lint
npm run typecheck
npm run build
```

Do not commit local secrets, PDFs, databases, extracted chunks, embeddings, or generated document artifacts. The `.gitignore` is set up to keep those files out of git.

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
