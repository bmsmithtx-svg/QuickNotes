import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  Database,
  FileText,
  Filter,
  GraduationCap,
  Search,
  Tags,
  Upload
} from "lucide-react";
import { sampleAnswer, studyDocuments, unsupportedAnswer } from "@/lib/sample-data";

const filters = [
  { label: "Class", value: "AP Biology", icon: GraduationCap },
  { label: "Topic", value: "Cells", icon: BookOpen },
  { label: "Date", value: "Jul 2", icon: CalendarDays },
  { label: "Tag", value: "osmosis", icon: Tags }
];

export function QuickNotesWorkspace() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-md bg-[var(--accent-strong)] text-white">
              <BookOpen aria-hidden="true" size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">QuickNotes</h1>
              <p className="text-sm text-[var(--muted)]">Study workspace</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/health"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-medium text-[var(--foreground)]"
            >
              <Database aria-hidden="true" size={16} />
              API status
            </a>
            <label
              htmlFor="pdf-upload"
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-white"
              title="Upload PDF"
            >
              <Upload aria-hidden="true" size={16} />
              Upload PDF
            </label>
            <input id="pdf-upload" type="file" accept="application/pdf" className="sr-only" />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
          <aside className="flex flex-col gap-4">
            <div className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Sources</h2>
                <FileText aria-hidden="true" size={18} className="text-[var(--accent)]" />
              </div>
              <div className="space-y-3">
                {studyDocuments.map((document) => (
                  <article key={document.id} className="rounded-md border border-[var(--border)] bg-[var(--panel-strong)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">{document.title}</h3>
                        <p className="mt-1 text-xs text-[var(--muted)]">{document.fileName}</p>
                      </div>
                      <span className="rounded-sm bg-white px-2 py-1 text-xs font-medium text-[var(--success)]">
                        {document.status}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
                      <div>
                        <dt>Class</dt>
                        <dd className="font-medium text-[var(--foreground)]">{document.className}</dd>
                      </div>
                      <div>
                        <dt>Pages</dt>
                        <dd className="font-medium text-[var(--foreground)]">{document.pageCount}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="mb-3 flex items-center gap-2">
                <Filter aria-hidden="true" size={17} className="text-[var(--accent)]" />
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Filters</h2>
              </div>
              <div className="space-y-2">
                {filters.map(({ label, value, icon: Icon }) => (
                  <button
                    key={label}
                    type="button"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-[var(--border)] bg-white px-3 text-left text-sm"
                  >
                    <span className="inline-flex items-center gap-2 text-[var(--muted)]">
                      <Icon aria-hidden="true" size={15} />
                      {label}
                    </span>
                    <span className="font-medium">{value}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="flex flex-col gap-4">
            <div className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-4">
              <label htmlFor="study-question" className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">
                Ask your sources
              </label>
              <div className="mt-3 flex flex-col gap-3 md:flex-row">
                <textarea
                  id="study-question"
                  rows={3}
                  defaultValue={sampleAnswer.question}
                  className="min-h-24 flex-1 resize-none rounded-md border border-[var(--border)] bg-white p-3 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                />
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--foreground)] px-4 text-sm font-semibold text-white md:self-end"
                  title="Search sources"
                >
                  <Search aria-hidden="true" size={16} />
                  Ask
                </button>
              </div>
            </div>

            <article className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-5">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-sm bg-[#e8f4ee] px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
                  <CheckCircle2 aria-hidden="true" size={14} />
                  Source-backed
                </span>
                <span className="rounded-sm bg-[#eef3f8] px-2.5 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                  Hybrid retrieval
                </span>
              </div>
              <h2 className="text-xl font-semibold">Answer</h2>
              <p className="mt-3 leading-7 text-[var(--foreground)]">{sampleAnswer.answer}</p>
            </article>

            <article className="rounded-md border border-dashed border-[var(--border)] bg-white p-5">
              <div className="mb-3 flex items-center gap-2 text-[var(--warning)]">
                <CircleHelp aria-hidden="true" size={18} />
                <h2 className="text-sm font-semibold uppercase tracking-normal">Not found fallback</h2>
              </div>
              <p className="text-sm text-[var(--muted)]">{unsupportedAnswer.answer}</p>
            </article>
          </section>

          <aside className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-4">
            <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Citation trail</h2>
            <div className="mt-3 space-y-3">
              {sampleAnswer.citations.map((citation) => (
                <article key={citation.id} className="rounded-md border border-[var(--border)] bg-[var(--panel-strong)] p-3">
                  <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                    <span>{citation.fileName}</span>
                    <span className="rounded-sm bg-white px-2 py-1">p. {citation.pageNumber}</span>
                  </div>
                  <blockquote className="mt-3 border-l-2 border-[var(--accent)] pl-3 text-sm leading-6 text-[var(--foreground)]">
                    {citation.sourceChunk}
                  </blockquote>
                  <p className="mt-2 text-xs text-[var(--muted)]">Chunk {citation.chunkIndex}</p>
                </article>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
