"use client";

import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Tags,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { DocumentContentResponse, StudyDocumentSummary, StudyDocumentUploadStatus } from "../lib/types";

type DocumentsResponse = {
  documents: StudyDocumentSummary[];
};

const statusLabels: Record<StudyDocumentUploadStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed"
};

const statusStyles: Record<StudyDocumentUploadStatus, string> = {
  uploaded: "bg-[#eef3f8] text-[var(--accent-strong)]",
  processing: "bg-[#fff4d7] text-[var(--warning)]",
  ready: "bg-[#e8f4ee] text-[var(--success)]",
  failed: "bg-[#fde8e8] text-[#9b1c1c]"
};

export function QuickNotesWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<StudyDocumentSummary[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [content, setContent] = useState<DocumentContentResponse | null>(null);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId]
  );

  const loadDocuments = useCallback(async (nextSelectedId?: string) => {
    setIsLoadingDocuments(true);
    try {
    const response = await fetch("/api/documents/list", {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Could not load documents.");
      }

      const payload = (await response.json()) as DocumentsResponse;
      setDocuments(payload.documents);

      if (nextSelectedId) {
        setSelectedDocumentId(nextSelectedId);
      } else if (!selectedDocumentId && payload.documents.length > 0) {
        setSelectedDocumentId(payload.documents[0].id);
      }
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [selectedDocumentId]);

  useEffect(() => {
    let isMounted = true;

    loadDocuments()
      .catch((error: unknown) => {
        if (isMounted) {
          setUploadError(error instanceof Error ? error.message : "Could not load documents.");
          setIsLoadingDocuments(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [loadDocuments]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setContent(null);
      return;
    }

    const controller = new AbortController();
    setIsLoadingContent(true);

    fetch(`/api/documents/${selectedDocumentId}/content?pageLimit=3&chunkLimit=8`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load document preview.");
        }

        return (await response.json()) as DocumentContentResponse;
      })
      .then((payload) => {
        setContent(payload);
        setIsLoadingContent(false);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setUploadError(error instanceof Error ? error.message : "Could not load document preview.");
          setIsLoadingContent(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [selectedDocumentId]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = fileInputRef.current?.files?.[0];

    setUploadError(null);
    setUploadMessage(null);

    if (!file) {
      setUploadError("Choose a PDF before uploading.");
      return;
    }

    if (file.type && file.type !== "application/pdf") {
      setUploadError("Only PDF files are supported.");
      return;
    }

    const formData = new FormData(form);
    formData.set("file", file);
    setIsUploading(true);
    setUploadMessage("Uploading and processing PDF...");

    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as { documentId?: string; error?: string; pageCount?: number; chunkCount?: number };

      if (!response.ok || !payload.documentId) {
        throw new Error(payload.error ?? "Upload failed.");
      }

      form.reset();
      setUploadMessage(`Ready: ${payload.pageCount ?? 0} pages, ${payload.chunkCount ?? 0} chunks.`);
      await loadDocuments(payload.documentId);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
      setUploadMessage(null);
    } finally {
      setIsUploading(false);
    }
  }

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
              <p className="text-sm text-[var(--muted)]">Document library</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadDocuments().catch(() => setUploadError("Could not refresh documents."))}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-medium text-[var(--foreground)]"
              title="Refresh documents"
            >
              <RefreshCw aria-hidden="true" size={16} />
              Refresh
            </button>
            <a
              href="/api/health"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-medium text-[var(--foreground)]"
            >
              <Database aria-hidden="true" size={16} />
              API status
            </a>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)_340px]">
          <aside className="flex flex-col gap-4">
            <section className="rounded-md border border-[var(--border)] bg-[var(--panel)]">
              <div className="border-b border-[var(--border)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Upload</h2>
                  <Upload aria-hidden="true" size={18} className="text-[var(--accent)]" />
                </div>
              </div>
              <form onSubmit={handleUpload} className="flex flex-col gap-3 p-4">
                <input
                  ref={fileInputRef}
                  name="file"
                  type="file"
                  accept="application/pdf"
                  className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-[var(--accent)] file:px-3 file:text-sm file:font-semibold file:text-white"
                  disabled={isUploading}
                />
                <input
                  name="title"
                  type="text"
                  placeholder="Title"
                  className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                  disabled={isUploading}
                />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <input
                    name="className"
                    type="text"
                    placeholder="Class"
                    className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                    disabled={isUploading}
                  />
                  <input
                    name="topic"
                    type="text"
                    placeholder="Topic"
                    className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                    disabled={isUploading}
                  />
                </div>
                <input
                  name="tags"
                  type="text"
                  placeholder="Tags"
                  className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                  disabled={isUploading}
                />
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--foreground)] px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isUploading}
                  title="Upload PDF"
                >
                  {isUploading ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Upload aria-hidden="true" size={16} />}
                  Upload PDF
                </button>
                {uploadMessage ? (
                  <p className="flex items-center gap-2 text-sm text-[var(--success)]">
                    <CheckCircle2 aria-hidden="true" size={16} />
                    {uploadMessage}
                  </p>
                ) : null}
                {uploadError ? (
                  <p className="flex items-center gap-2 text-sm text-[#9b1c1c]">
                    <AlertCircle aria-hidden="true" size={16} />
                    {uploadError}
                  </p>
                ) : null}
              </form>
            </section>

            <section className="rounded-md border border-[var(--border)] bg-[var(--panel)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Documents</h2>
                <FileText aria-hidden="true" size={18} className="text-[var(--accent)]" />
              </div>
              <div className="divide-y divide-[var(--border)]">
                {isLoadingDocuments ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-[var(--muted)]">
                    <Loader2 aria-hidden="true" size={16} className="animate-spin" />
                    Loading
                  </div>
                ) : null}
                {!isLoadingDocuments && documents.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--muted)]">No PDFs uploaded.</p>
                ) : null}
                {documents.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => setSelectedDocumentId(document.id)}
                    className={`block w-full px-4 py-3 text-left transition ${
                      document.id === selectedDocumentId ? "bg-[var(--panel-strong)]" : "bg-white hover:bg-[var(--panel-strong)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">{document.title}</h3>
                        <p className="mt-1 truncate text-xs text-[var(--muted)]">{document.originalFileName}</p>
                      </div>
                      <StatusBadge status={document.uploadStatus} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                      <span>{document.pageCount ?? 0} pages</span>
                      <span>{document.chunkCount} chunks</span>
                      <span>{formatDate(document.createdAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className="rounded-md border border-[var(--border)] bg-[var(--panel)]">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{selectedDocument?.title ?? "Extracted chunks"}</h2>
                <p className="mt-1 truncate text-sm text-[var(--muted)]">{selectedDocument?.originalFileName ?? "Select a document"}</p>
              </div>
              {selectedDocument ? <StatusBadge status={selectedDocument.uploadStatus} /> : null}
            </div>

            <div className="divide-y divide-[var(--border)]">
              {isLoadingContent ? (
                <div className="flex items-center gap-2 p-5 text-sm text-[var(--muted)]">
                  <Loader2 aria-hidden="true" size={16} className="animate-spin" />
                  Loading preview
                </div>
              ) : null}
              {!isLoadingContent && !selectedDocument ? (
                <p className="p-5 text-sm text-[var(--muted)]">No document selected.</p>
              ) : null}
              {!isLoadingContent && selectedDocument && content?.chunks.length === 0 ? (
                <p className="p-5 text-sm text-[var(--muted)]">No extracted chunks available.</p>
              ) : null}
              {!isLoadingContent
                ? content?.chunks.map((chunk) => (
                    <article key={chunk.id} className="p-5">
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                        <span className="rounded-sm bg-[var(--panel-strong)] px-2 py-1">Page {chunk.pageNumber}</span>
                        <span className="rounded-sm bg-[var(--panel-strong)] px-2 py-1">Chunk {chunk.chunkIndex}</span>
                        <span>{chunk.characterCount} chars</span>
                        <span>{chunk.tokenEstimate} est. tokens</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">{chunk.text}</p>
                    </article>
                  ))
                : null}
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <section className="rounded-md border border-[var(--border)] bg-[var(--panel)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Metadata</h2>
                <Tags aria-hidden="true" size={17} className="text-[var(--accent)]" />
              </div>
              {selectedDocument ? (
                <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
                  <MetadataItem label="Pages" value={String(selectedDocument.pageCount ?? 0)} />
                  <MetadataItem label="Chunks" value={String(selectedDocument.chunkCount)} />
                  <MetadataItem label="Size" value={formatFileSize(selectedDocument.fileSize)} />
                  <MetadataItem label="Created" value={formatDate(selectedDocument.createdAt)} />
                  <MetadataItem label="Class" value={selectedDocument.className ?? "None"} />
                  <MetadataItem label="Topic" value={selectedDocument.topic ?? "None"} />
                  <div className="col-span-2">
                    <dt className="text-xs uppercase tracking-normal text-[var(--muted)]">Tags</dt>
                    <dd className="mt-1 flex flex-wrap gap-2">
                      {selectedDocument.tags.length > 0 ? (
                        selectedDocument.tags.map((tag) => (
                          <span key={tag} className="rounded-sm bg-[var(--panel-strong)] px-2 py-1 text-xs font-medium">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm font-medium">None</span>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="p-4 text-sm text-[var(--muted)]">No metadata.</p>
              )}
            </section>

            <section className="rounded-md border border-[var(--border)] bg-[var(--panel)]">
              <div className="border-b border-[var(--border)] p-4">
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Page Text</h2>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {content?.pages.length ? (
                  content.pages.map((page) => (
                    <article key={page.id} className="p-4">
                      <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Page {page.pageNumber}</div>
                      <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-6">{page.text || "No extractable text on this page."}</p>
                    </article>
                  ))
                ) : (
                  <p className="p-4 text-sm text-[var(--muted)]">No page preview.</p>
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: StudyDocumentUploadStatus }) {
  return <span className={`shrink-0 rounded-sm px-2 py-1 text-xs font-semibold ${statusStyles[status]}`}>{statusLabels[status]}</span>;
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-normal text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
