"use client";

import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Database,
  ExternalLink,
  Filter,
  FileText,
  Loader2,
  LogOut,
  MessageSquareText,
  Quote,
  RefreshCw,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type ReactNode,
  type SetStateAction
} from "react";

import { createClientAsync } from "@/lib/supabase/client";
import type {
  AppliedRetrievalFilters,
  AnswerCitation,
  AnswerResponse,
  ChunkSearchResult,
  DocumentUploadResponse,
  DocumentContentResponse,
  MetadataOptionsResponse,
  RetrievalFilters,
  RetrievalMode,
  SearchResponse,
  SearchModeAvailability,
  StudyDocumentSummary,
  StudyDocumentUploadStatus
} from "../lib/types";

type DocumentsResponse = {
  documents: StudyDocumentSummary[];
};

type SearchErrorPayload = {
  error?: string;
  requestedMode?: RetrievalMode | "auto";
  mode?: RetrievalMode;
  actualMode?: RetrievalMode;
  semantic?: SearchModeAvailability;
};

type AnswerErrorPayload = {
  error?: string;
};

type FilterState = {
  documentIds: string[];
  classNames: string[];
  topics: string[];
  sources: string[];
  tags: string[];
  documentDateFrom: string;
  documentDateTo: string;
};

type MetadataFormState = {
  title: string;
  className: string;
  topic: string;
  source: string;
  documentDate: string;
  tags: string;
};

type MetadataSaveState = "idle" | "saving" | "saved" | "error";
type WorkspaceTab = "pdfs" | "search" | "metadata";

type DocumentDetailResponse = {
  document: StudyDocumentSummary;
};

const workspaceTabs: Array<{ id: WorkspaceTab; label: string; icon: typeof FileText }> = [
  { id: "pdfs", label: "PDFs", icon: FileText },
  { id: "search", label: "Search", icon: Search },
  { id: "metadata", label: "Metadata", icon: Tags }
];

const emptyFilters: FilterState = {
  documentIds: [],
  classNames: [],
  topics: [],
  sources: [],
  tags: [],
  documentDateFrom: "",
  documentDateTo: ""
};

const emptyMetadataOptions: MetadataOptionsResponse = {
  classes: [],
  topics: [],
  sources: [],
  tags: []
};

const statusLabels: Record<StudyDocumentUploadStatus, string> = {
  UPLOADING: "Uploading",
  PROCESSING: "Processing",
  READY: "Ready",
  FAILED: "Failed",
  DELETING: "Deleting"
};

const statusStyles: Record<StudyDocumentUploadStatus, string> = {
  UPLOADING: "qn-status-uploading",
  PROCESSING: "qn-status-processing",
  READY: "qn-status-ready",
  FAILED: "qn-status-failed",
  DELETING: "qn-status-deleting"
};

const searchModeOptions: Array<{ mode: RetrievalMode; label: string }> = [
  { mode: "hybrid", label: "Hybrid" },
  { mode: "semantic", label: "Semantic" },
  { mode: "keyword", label: "Keyword" }
];

const textInputClass = "qn-field h-10 rounded-md px-3 text-sm outline-none";
const textAreaClass = "qn-field min-h-24 rounded-md px-3 py-2 text-sm leading-6 outline-none";
const fileInputClass =
  "block w-full text-sm text-[var(--muted)] file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-[var(--accent)] file:px-3 file:text-sm file:font-semibold file:text-[var(--accent-contrast)] hover:file:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60";

export function normalizeWorkspaceTab(value: string | null | undefined): WorkspaceTab {
  return value === "search" || value === "metadata" || value === "pdfs" ? value : "pdfs";
}

export function getWorkspaceTabHref(currentHref: string, tab: WorkspaceTab, documentId?: string | null) {
  const url = new URL(currentHref);
  url.searchParams.set("tab", tab);

  if (documentId === null) {
    url.searchParams.delete("documentId");
  } else if (documentId) {
    url.searchParams.set("documentId", documentId);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function resolveSelectedDocumentIdAfterLoad(
  currentId: string | null,
  documents: StudyDocumentSummary[],
  requestedId?: string | null
) {
  const ids = new Set(documents.map((document) => document.id));

  if (requestedId && ids.has(requestedId)) {
    return requestedId;
  }

  if (currentId && ids.has(currentId)) {
    return currentId;
  }

  return documents[0]?.id ?? null;
}

export function applySavedDocumentToWorkspaceState(
  documents: StudyDocumentSummary[],
  content: DocumentContentResponse | null,
  savedDocument: StudyDocumentSummary
) {
  return {
    documents: documents.map((document) => (document.id === savedDocument.id ? savedDocument : document)),
    content:
      content?.document.id === savedDocument.id
        ? {
            ...content,
            document: {
              ...content.document,
              ...savedDocument
            }
      }
        : content
  };
}

export function getMetadataPanelState(selectedDocument: StudyDocumentSummary | null, documents: StudyDocumentSummary[]) {
  if (selectedDocument) {
    return "editor";
  }

  return documents.length > 0 ? "selector" : "pdfs-tab-button";
}

export function QuickNotesWorkspace({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentsRef = useRef<StudyDocumentSummary[]>([]);
  const selectedDocumentIdRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("pdfs");
  const [documents, setDocuments] = useState<StudyDocumentSummary[]>([]);
  const [metadataOptions, setMetadataOptions] = useState<MetadataOptionsResponse>(emptyMetadataOptions);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [content, setContent] = useState<DocumentContentResponse | null>(null);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [metadataOptionsError, setMetadataOptionsError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<RetrievalMode>("hybrid");
  const [searchResults, setSearchResults] = useState<ChunkSearchResult[]>([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<ChunkSearchResult | null>(null);
  const [searchAppliedFilters, setSearchAppliedFilters] = useState<AppliedRetrievalFilters | null>(null);
  const [searchMetadata, setSearchMetadata] = useState<Pick<
    SearchResponse,
    "requestedMode" | "mode" | "actualMode" | "semantic" | "resultCount" | "ranking"
  > | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [answerQuestion, setAnswerQuestion] = useState("");
  const [answerMode, setAnswerMode] = useState<RetrievalMode>("hybrid");
  const [answerResponse, setAnswerResponse] = useState<AnswerResponse | null>(null);
  const [selectedCitationId, setSelectedCitationId] = useState<number | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [metadataForm, setMetadataForm] = useState<MetadataFormState>({
    title: "",
    className: "",
    topic: "",
    source: "",
    documentDate: "",
    tags: ""
  });
  const [metadataSaveState, setMetadataSaveState] = useState<MetadataSaveState>("idle");
  const [metadataSaveMessage, setMetadataSaveMessage] = useState<string | null>(null);
  const [documentActionId, setDocumentActionId] = useState<string | null>(null);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId]
  );
  const selectedCitation = useMemo(
    () => answerResponse?.citations.find((citation) => citation.id === selectedCitationId) ?? null,
    [answerResponse, selectedCitationId]
  );
  const hasActiveFilters = useMemo(() => isFilterStateActive(filters), [filters]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    selectedDocumentIdRef.current = selectedDocumentId;
  }, [selectedDocumentId]);

  const handleUnauthorizedResponse = useCallback(
    (response: Response) => {
      if (response.status !== 401) {
        return false;
      }

      router.replace("/auth?reason=session-expired");
      return true;
    },
    [router]
  );

  const updateWorkspaceUrl = useCallback((updates: { tab?: WorkspaceTab; documentId?: string | null }, mode: "push" | "replace" = "push") => {
    if (typeof window === "undefined") {
      return;
    }

    const nextHref = getWorkspaceTabHref(
      window.location.href,
      updates.tab ?? normalizeWorkspaceTab(new URL(window.location.href).searchParams.get("tab")),
      updates.documentId
    );

    if (nextHref === `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      return;
    }

    const method = mode === "replace" ? "replaceState" : "pushState";
    window.history[method](null, "", nextHref);
  }, []);

  const selectWorkspaceTab = useCallback(
    (tab: WorkspaceTab, mode: "push" | "replace" = "push") => {
      setActiveTab(tab);
      updateWorkspaceUrl({ tab, documentId: selectedDocumentId }, mode);
    },
    [selectedDocumentId, updateWorkspaceUrl]
  );

  const selectDocument = useCallback(
    (documentId: string | null, mode: "push" | "replace" = "push") => {
      setSelectedDocumentId(documentId);
      updateWorkspaceUrl({ documentId }, mode);
    },
    [updateWorkspaceUrl]
  );

  async function handleSignOut() {
    try {
      const supabase = await createClientAsync();
      await supabase.auth.signOut();
    } finally {
      router.replace("/auth");
      router.refresh();
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function syncFromLocation() {
      const url = new URL(window.location.href);
      const normalizedTab = normalizeWorkspaceTab(url.searchParams.get("tab"));
      setActiveTab(normalizedTab);

      if (url.searchParams.has("documentId") && documentsRef.current.length > 0) {
        const requestedDocumentId = url.searchParams.get("documentId");
        const nextDocumentId = resolveSelectedDocumentIdAfterLoad(null, documentsRef.current, requestedDocumentId);
        setSelectedDocumentId(nextDocumentId);

        if (requestedDocumentId !== nextDocumentId) {
          window.history.replaceState(null, "", getWorkspaceTabHref(window.location.href, normalizedTab, nextDocumentId));
        }
      }

      if (url.searchParams.has("tab") && url.searchParams.get("tab") !== normalizedTab) {
        window.history.replaceState(null, "", getWorkspaceTabHref(window.location.href, normalizedTab));
      }
    }

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);

    return () => {
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  const loadDocuments = useCallback(async (nextSelectedId?: string) => {
    setIsLoadingDocuments(true);
    try {
      const response = await fetch("/api/documents/list", {
        cache: "no-store"
      });

      if (!response.ok) {
        if (handleUnauthorizedResponse(response)) {
          throw new Error("Session expired.");
        }

        throw new Error("Could not load documents.");
      }

      const payload = (await response.json()) as DocumentsResponse;
      setDocuments(payload.documents);
      const urlDocumentId =
        typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("documentId") : null;
      const resolvedDocumentId = resolveSelectedDocumentIdAfterLoad(
        selectedDocumentIdRef.current,
        payload.documents,
        nextSelectedId ?? urlDocumentId
      );
      setSelectedDocumentId(resolvedDocumentId);
      updateWorkspaceUrl({ documentId: resolvedDocumentId }, "replace");
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [handleUnauthorizedResponse, updateWorkspaceUrl]);

  const loadMetadataOptions = useCallback(async () => {
    setMetadataOptionsError(null);

    try {
      const response = await fetch("/api/documents/metadata-options", {
        cache: "no-store"
      });

      if (!response.ok) {
        if (handleUnauthorizedResponse(response)) {
          throw new Error("Session expired.");
        }

        throw new Error("Could not load metadata filters.");
      }

      setMetadataOptions((await response.json()) as MetadataOptionsResponse);
    } catch (error) {
      setMetadataOptionsError(error instanceof Error ? error.message : "Could not load metadata filters.");
    }
  }, [handleUnauthorizedResponse]);

  useEffect(() => {
    let isMounted = true;

    Promise.all([loadDocuments(), loadMetadataOptions()])
      .catch((error: unknown) => {
        if (isMounted) {
          setUploadError(error instanceof Error ? error.message : "Could not load documents.");
          setIsLoadingDocuments(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [loadDocuments, loadMetadataOptions]);

  useEffect(() => {
    setMetadataSaveState("idle");
    setMetadataSaveMessage(null);
    setMetadataForm({
      title: selectedDocument?.title ?? "",
      className: selectedDocument?.className ?? "",
      topic: selectedDocument?.topic ?? "",
      source: selectedDocument?.source ?? "",
      documentDate: selectedDocument?.documentDate ?? "",
      tags: selectedDocument?.tags.join(", ") ?? ""
    });
  }, [selectedDocument]);

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
          if (handleUnauthorizedResponse(response)) {
            throw new Error("Session expired.");
          }

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
  }, [handleUnauthorizedResponse, selectedDocumentId]);

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
      if (handleUnauthorizedResponse(response)) {
        throw new Error("Session expired.");
      }

      const payload = (await response.json()) as Partial<DocumentUploadResponse> & { error?: string };

      if (!response.ok || !payload.documentId) {
        throw new Error(payload.error ?? "Upload failed.");
      }

      form.reset();
      setUploadMessage(formatUploadMessage(payload));
      await loadDocuments(payload.documentId);
      await loadMetadataOptions();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
      setUploadMessage(null);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();

    setSearchError(null);

    if (!query) {
      setSearchResults([]);
      setSelectedSearchResult(null);
      setSearchMetadata(null);
      return;
    }

    setIsSearching(true);
    setSearchMetadata(null);
    setSearchAppliedFilters(null);

    try {
      const parameters = new URLSearchParams({ q: query, mode: searchMode });
      appendFiltersToSearchParams(parameters, filters);
      const response = await fetch(`/api/search?${parameters.toString()}`, {
        cache: "no-store"
      });
      if (handleUnauthorizedResponse(response)) {
        throw new Error("Session expired.");
      }

      const payload = (await response.json()) as SearchResponse | SearchErrorPayload;

      if (!response.ok || !("results" in payload)) {
        if ("semantic" in payload && payload.semantic) {
          setSearchMetadata({
            requestedMode: payload.requestedMode ?? searchMode,
            mode: payload.mode ?? "keyword",
            actualMode: payload.actualMode ?? "keyword",
            semantic: payload.semantic,
            resultCount: 0,
            ranking: {
              formula: ""
            }
          });
        }

        throw new Error("error" in payload ? payload.error ?? "Search failed." : "Search failed.");
      }

      setSearchResults(payload.results);
      setSearchAppliedFilters(payload.filters);
      setSearchMetadata({
        requestedMode: payload.requestedMode,
        mode: payload.mode,
        actualMode: payload.actualMode,
        semantic: payload.semantic,
        resultCount: payload.resultCount,
        ranking: payload.ranking
      });
      setSelectedSearchResult(payload.results[0] ?? null);

      if (payload.results[0]) {
        selectDocument(payload.results[0].documentId, "replace");
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed.");
      setSearchResults([]);
      setSelectedSearchResult(null);
      setSearchAppliedFilters(null);
      setSearchMetadata((currentMetadata) => (currentMetadata?.resultCount === 0 ? currentMetadata : null));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = answerQuestion.trim();

    setAnswerError(null);

    if (!question) {
      setAnswerResponse(null);
      setSelectedCitationId(null);
      return;
    }

    setIsAnswering(true);

    try {
      const response = await fetch("/api/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question,
          mode: answerMode,
          topK: 8,
          filters: filtersToPayload(filters)
        })
      });
      if (handleUnauthorizedResponse(response)) {
        throw new Error("Session expired.");
      }

      const payload = (await response.json()) as AnswerResponse | AnswerErrorPayload;

      if (!response.ok || !("status" in payload)) {
        throw new Error("error" in payload ? payload.error ?? "Answer generation failed." : "Answer generation failed.");
      }

      setAnswerResponse(payload);
      setSelectedCitationId(payload.citations[0]?.id ?? null);

      if (payload.retrievedChunks[0]) {
        selectDocument(payload.retrievedChunks[0].documentId, "replace");
      }
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : "Answer generation failed.");
      setAnswerResponse(null);
      setSelectedCitationId(null);
    } finally {
      setIsAnswering(false);
    }
  }

  function selectSearchResult(result: ChunkSearchResult) {
    setSelectedSearchResult(result);
    selectDocument(result.documentId);
  }

  async function handleMetadataSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDocument) {
      return;
    }

    setMetadataSaveState("saving");
    setMetadataSaveMessage(null);

    try {
      const response = await fetch(`/api/documents/${selectedDocument.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: metadataForm.title,
          className: metadataForm.className,
          topic: metadataForm.topic,
          source: metadataForm.source,
          documentDate: metadataForm.documentDate || null,
          tags: splitTags(metadataForm.tags)
        })
      });
      if (handleUnauthorizedResponse(response)) {
        throw new Error("Session expired.");
      }

      const payload = (await response.json()) as DocumentDetailResponse | { error?: string };

      if (!response.ok || !("document" in payload)) {
        throw new Error("error" in payload ? payload.error ?? "Could not save metadata." : "Could not save metadata.");
      }

      setDocuments((currentDocuments) => applySavedDocumentToWorkspaceState(currentDocuments, null, payload.document).documents);
      setContent((currentContent) => applySavedDocumentToWorkspaceState([], currentContent, payload.document).content);
      setMetadataForm({
        title: payload.document.title,
        className: payload.document.className ?? "",
        topic: payload.document.topic ?? "",
        source: payload.document.source ?? "",
        documentDate: payload.document.documentDate ?? "",
        tags: payload.document.tags.join(", ")
      });
      setMetadataSaveState("saved");
      setMetadataSaveMessage("Metadata saved.");
      await loadMetadataOptions();
    } catch (error) {
      setMetadataSaveState("error");
      setMetadataSaveMessage(error instanceof Error ? error.message : "Could not save metadata.");
    }
  }

  async function handleRetryDocument(document: StudyDocumentSummary) {
    setUploadError(null);
    setUploadMessage(null);
    setDocumentActionId(document.id);

    try {
      const response = await fetch(`/api/documents/${document.id}/retry`, {
        method: "POST"
      });
      if (handleUnauthorizedResponse(response)) {
        throw new Error("Session expired.");
      }

      const payload = (await response.json()) as Partial<DocumentUploadResponse> & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Document retry failed.");
      }

      setUploadMessage(formatUploadMessage(payload));
      await loadDocuments(document.id);
      await loadMetadataOptions();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Document retry failed.");
    } finally {
      setDocumentActionId(null);
    }
  }

  async function handleDeleteDocument(document: StudyDocumentSummary) {
    if (!window.confirm(`Delete "${document.title}" and its stored PDF?`)) {
      return;
    }

    setUploadError(null);
    setUploadMessage(null);
    setDocumentActionId(document.id);

    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        method: "DELETE"
      });
      if (handleUnauthorizedResponse(response)) {
        throw new Error("Session expired.");
      }

      const payload = (await response.json()) as { error?: string; status?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Document deletion failed.");
      }

      setUploadMessage("Document deleted.");
      if (selectedDocumentIdRef.current === document.id) {
        selectDocument(null, "replace");
      }
      setContent((currentContent) => (currentContent?.document.id === document.id ? null : currentContent));
      await loadDocuments();
      await loadMetadataOptions();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Document deletion failed.");
    } finally {
      setDocumentActionId(null);
    }
  }

  function handleWorkspaceTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: WorkspaceTab) {
    const currentIndex = workspaceTabs.findIndex((workspaceTab) => workspaceTab.id === tab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % workspaceTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + workspaceTabs.length) % workspaceTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = workspaceTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = workspaceTabs[nextIndex].id;
    selectWorkspaceTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`qn-tab-${nextTab}`)?.focus());
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-contrast)]">
              <BookOpen aria-hidden="true" size={22} />
            </div>
            <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-normal">QuickNotes</h1>
                <p className="text-sm text-[var(--muted)]">Document library</p>
              </div>
              <div className="mt-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none">
                <span aria-hidden="true" className="qn-smitty-mark size-5 shrink-0 rounded-sm opacity-80" />
                <span className="text-[0.68rem] font-medium text-[var(--muted)]">Powered by</span>
                <span className="text-xs font-semibold text-[var(--accent-strong)]">SmittyAI</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {userEmail ? <span className="text-sm text-[var(--muted)]">{userEmail}</span> : null}
            <button
              type="button"
              onClick={() => loadDocuments().catch(() => setUploadError("Could not refresh documents."))}
              className="qn-secondary-button inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium"
              title="Refresh documents"
            >
              <RefreshCw aria-hidden="true" size={16} />
              Refresh
            </button>
            <a
              href="/api/health"
              className="qn-secondary-button inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium"
            >
              <Database aria-hidden="true" size={16} />
              API status
            </a>
            <button
              type="button"
              onClick={() => {
                void handleSignOut();
              }}
              className="qn-secondary-button inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium"
              title="Sign out"
            >
              <LogOut aria-hidden="true" size={16} />
              Sign out
            </button>
          </div>
        </header>

        <WorkspaceTabNavigation activeTab={activeTab} onSelect={selectWorkspaceTab} onKeyDown={handleWorkspaceTabKeyDown} />

        <section
          id={`qn-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`qn-tab-${activeTab}`}
          tabIndex={0}
          className="outline-none"
        >
          {activeTab === "pdfs" ? (
            <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
              <aside className="flex flex-col gap-4">
                <UploadPanel
                  fileInputRef={fileInputRef}
                  isUploading={isUploading}
                  uploadMessage={uploadMessage}
                  uploadError={uploadError}
                  onUpload={handleUpload}
                />
                <DocumentsPanel
                  documents={documents}
                  selectedDocumentId={selectedDocumentId}
                  isLoadingDocuments={isLoadingDocuments}
                  onSelect={(documentId) => {
                    selectDocument(documentId);
                    setSelectedSearchResult(null);
                  }}
                />
              </aside>
              <div className="flex min-w-0 flex-col gap-4">
                <DocumentPreviewPanel
                  selectedDocument={selectedDocument}
                  selectedDocumentId={selectedDocumentId}
                  selectedSearchResult={selectedSearchResult}
                  content={content}
                  isLoadingContent={isLoadingContent}
                  documentActionId={documentActionId}
                  onRetry={handleRetryDocument}
                  onDelete={handleDeleteDocument}
                />
                <PageTextPanel content={content} />
              </div>
            </div>
          ) : null}

          {activeTab === "search" ? (
            <div className="flex flex-col gap-5">
              <SearchControlsPanel
                filters={filters}
                documents={documents}
                metadataOptions={metadataOptions}
                metadataOptionsError={metadataOptionsError}
                searchMode={searchMode}
                searchQuery={searchQuery}
                searchMetadata={searchMetadata}
                searchAppliedFilters={searchAppliedFilters}
                searchError={searchError}
                isSearching={isSearching}
                isAnswering={isAnswering}
                onSearch={handleSearch}
                onSearchModeChange={setSearchMode}
                onSearchQueryChange={setSearchQuery}
                onFiltersChange={setFilters}
                onClearFilters={() => setFilters(emptyFilters)}
              />
              <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <SearchResultsPanel
                  searchQuery={searchQuery}
                  results={searchResults}
                  selectedSearchResult={selectedSearchResult}
                  isSearching={isSearching}
                  searchError={searchError}
                  hasActiveFilters={hasActiveFilters}
                  onSelect={selectSearchResult}
                />
                <AnswerPanel
                  filters={filters}
                  documents={documents}
                  answerMode={answerMode}
                  answerQuestion={answerQuestion}
                  answerResponse={answerResponse}
                  selectedCitation={selectedCitation}
                  selectedCitationId={selectedCitationId}
                  answerError={answerError}
                  isAnswering={isAnswering}
                  onAnswer={handleAnswer}
                  onAnswerModeChange={setAnswerMode}
                  onAnswerQuestionChange={setAnswerQuestion}
                  onCitationSelect={setSelectedCitationId}
                />
              </div>
              <DocumentPreviewPanel
                selectedDocument={selectedDocument}
                selectedDocumentId={selectedDocumentId}
                selectedSearchResult={selectedSearchResult}
                content={content}
                isLoadingContent={isLoadingContent}
                documentActionId={documentActionId}
                onRetry={handleRetryDocument}
                onDelete={handleDeleteDocument}
              />
            </div>
          ) : null}

          {activeTab === "metadata" ? (
            <MetadataPanel
              documents={documents}
              selectedDocument={selectedDocument}
              metadataForm={metadataForm}
              metadataSaveState={metadataSaveState}
              metadataSaveMessage={metadataSaveMessage}
              onFormChange={setMetadataForm}
              onSave={handleMetadataSave}
              onDocumentSelect={(documentId) => selectDocument(documentId)}
              onGoToPdfs={() => selectWorkspaceTab("pdfs")}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function WorkspaceTabNavigation({
  activeTab,
  onSelect,
  onKeyDown
}: {
  activeTab: WorkspaceTab;
  onSelect: (tab: WorkspaceTab) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, tab: WorkspaceTab) => void;
}) {
  return (
    <nav aria-label="Workspace sections">
      <div className="qn-workspace-tabs" role="tablist" aria-label="QuickNotes workspace">
        {workspaceTabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              id={`qn-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`qn-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => onKeyDown(event, tab.id)}
              className={`qn-workspace-tab ${selected ? "qn-workspace-tab-active" : ""}`}
            >
              <Icon aria-hidden="true" size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function UploadPanel({
  fileInputRef,
  isUploading,
  uploadMessage,
  uploadError,
  onUpload
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  isUploading: boolean;
  uploadMessage: string | null;
  uploadError: string | null;
  onUpload: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="qn-panel rounded-md">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Upload</h2>
          <Upload aria-hidden="true" size={18} className="text-[var(--accent)]" />
        </div>
      </div>
      <form onSubmit={onUpload} className="flex flex-col gap-3 p-4">
        <input
          ref={fileInputRef}
          name="file"
          type="file"
          accept="application/pdf"
          className={fileInputClass}
          disabled={isUploading}
        />
        <input name="title" type="text" placeholder="Title" className={textInputClass} disabled={isUploading} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <input name="className" type="text" placeholder="Class" className={textInputClass} disabled={isUploading} />
          <input name="topic" type="text" placeholder="Topic" className={textInputClass} disabled={isUploading} />
        </div>
        <input name="source" type="text" placeholder="Source" className={textInputClass} disabled={isUploading} />
        <input name="documentDate" type="date" className={textInputClass} disabled={isUploading} aria-label="Document date" />
        <input name="tags" type="text" placeholder="Tags" className={textInputClass} disabled={isUploading} />
        <button
          type="submit"
          className="qn-primary-button inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isUploading}
          title="Upload PDF"
        >
          {isUploading ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Upload aria-hidden="true" size={16} />}
          Upload PDF
        </button>
        {uploadMessage ? (
          <p className="qn-state-success flex items-center gap-2 text-sm">
            <CheckCircle2 aria-hidden="true" size={16} />
            {uploadMessage}
          </p>
        ) : null}
        {uploadError ? (
          <p className="qn-state-error flex items-center gap-2 rounded-md px-3 py-2 text-sm">
            <AlertCircle aria-hidden="true" size={16} />
            {uploadError}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function DocumentsPanel({
  documents,
  selectedDocumentId,
  isLoadingDocuments,
  onSelect
}: {
  documents: StudyDocumentSummary[];
  selectedDocumentId: string | null;
  isLoadingDocuments: boolean;
  onSelect: (documentId: string) => void;
}) {
  return (
    <section className="qn-panel rounded-md">
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
        {!isLoadingDocuments && documents.length === 0 ? <p className="p-4 text-sm text-[var(--muted)]">No PDFs uploaded.</p> : null}
        {documents.map((document) => (
          <button
            key={document.id}
            type="button"
            onClick={() => onSelect(document.id)}
            className={`qn-row block w-full px-4 py-3 text-left ${document.id === selectedDocumentId ? "qn-row-selected" : ""}`}
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
  );
}

function SearchControlsPanel({
  filters,
  documents,
  metadataOptions,
  metadataOptionsError,
  searchMode,
  searchQuery,
  searchMetadata,
  searchAppliedFilters,
  searchError,
  isSearching,
  isAnswering,
  onSearch,
  onSearchModeChange,
  onSearchQueryChange,
  onFiltersChange,
  onClearFilters
}: {
  filters: FilterState;
  documents: StudyDocumentSummary[];
  metadataOptions: MetadataOptionsResponse;
  metadataOptionsError: string | null;
  searchMode: RetrievalMode;
  searchQuery: string;
  searchMetadata: Pick<SearchResponse, "requestedMode" | "mode" | "actualMode" | "semantic" | "resultCount" | "ranking"> | null;
  searchAppliedFilters: AppliedRetrievalFilters | null;
  searchError: string | null;
  isSearching: boolean;
  isAnswering: boolean;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSearchModeChange: (mode: RetrievalMode) => void;
  onSearchQueryChange: (query: string) => void;
  onFiltersChange: (filters: FilterState) => void;
  onClearFilters: () => void;
}) {
  const active = isFilterStateActive(filters);

  return (
    <section className="qn-panel rounded-md">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Search</h2>
        <Search aria-hidden="true" size={18} className="text-[var(--accent)]" />
      </div>
      <form onSubmit={onSearch} className="grid gap-3 p-4 lg:grid-cols-[280px_minmax(0,1fr)_auto] lg:items-center">
        <div className="qn-segmented grid grid-cols-3 rounded-md p-1" role="radiogroup" aria-label="Search mode">
          {searchModeOptions.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => onSearchModeChange(option.mode)}
              className={`qn-segment h-9 rounded-sm text-xs font-semibold ${searchMode === option.mode ? "qn-segment-active" : ""}`}
              aria-pressed={searchMode === option.mode}
              disabled={isSearching}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          type="search"
          placeholder="Find text in chunks"
          className={`${textInputClass} min-w-0`}
          disabled={isSearching}
        />
        <button
          type="submit"
          className="qn-primary-button inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSearching}
          title="Search chunks"
        >
          {isSearching ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Search aria-hidden="true" size={16} />}
          Search
        </button>
      </form>
      <div className="grid gap-4 border-t border-[var(--border)] p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">Current scope</p>
          <ActiveScope filters={filters} documents={documents} emptyLabel="All documents" />
          {searchAppliedFilters ? (
            <div className="mt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">Last search filters</p>
              <ActiveScope filters={searchAppliedFilters} documents={documents} />
            </div>
          ) : null}
        </div>
        <details className="qn-filter-disclosure rounded-md" open={active}>
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold">
            <Filter aria-hidden="true" size={15} />
            {active ? "Filters active" : "Filters"}
          </summary>
          <MetadataFilterControls
            filters={filters}
            documents={documents}
            options={metadataOptions}
            disabled={isSearching || isAnswering}
            layout="compact"
            onChange={onFiltersChange}
            onClear={onClearFilters}
          />
        </details>
      </div>
      {metadataOptionsError ? <p className="qn-state-error m-4 rounded-md px-3 py-2 text-sm">{metadataOptionsError}</p> : null}
      {searchMetadata ? <SearchModeNotice metadata={searchMetadata} selectedMode={searchMode} /> : null}
      {searchError ? <p className="qn-state-error m-4 rounded-md px-3 py-2 text-sm">{searchError}</p> : null}
    </section>
  );
}

function SearchResultsPanel({
  searchQuery,
  results,
  selectedSearchResult,
  isSearching,
  searchError,
  hasActiveFilters,
  onSelect
}: {
  searchQuery: string;
  results: ChunkSearchResult[];
  selectedSearchResult: ChunkSearchResult | null;
  isSearching: boolean;
  searchError: string | null;
  hasActiveFilters: boolean;
  onSelect: (result: ChunkSearchResult) => void;
}) {
  return (
    <section className="qn-panel rounded-md">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Results</h2>
        <FileText aria-hidden="true" size={18} className="text-[var(--accent)]" />
      </div>
      <div className="divide-y divide-[var(--border)]">
        {isSearching ? (
          <div className="flex items-center gap-2 p-4 text-sm text-[var(--muted)]">
            <Loader2 aria-hidden="true" size={16} className="animate-spin" />
            Searching
          </div>
        ) : null}
        {!isSearching && searchQuery.trim() && results.length === 0 && !searchError ? (
          <p className="p-4 text-sm text-[var(--muted)]">
            {hasActiveFilters ? "No matching chunks. The selected filters may be too restrictive." : "No matching chunks."}
          </p>
        ) : null}
        {!isSearching && !searchQuery.trim() && results.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">Search your PDFs by keyword, semantic meaning, or hybrid ranking.</p>
        ) : null}
        {results.map((result) => (
          <button
            key={result.chunkId}
            type="button"
            onClick={() => onSelect(result)}
            className={`qn-row block w-full px-4 py-3 text-left ${result.chunkId === selectedSearchResult?.chunkId ? "qn-row-selected" : ""}`}
          >
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[var(--muted)]">
              <span>{formatPrimaryRanking(result)}</span>
              <span>Page {result.pageNumber} / Chunk {result.chunkIndex}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--muted)]">
              {formatRankingBadges(result).map((badge) => (
                <span key={badge} className="qn-chip rounded-sm px-2 py-1">
                  {badge}
                </span>
              ))}
            </div>
            <h3 className="mt-2 truncate text-sm font-semibold">{result.documentTitle}</h3>
            <p className="mt-1 truncate text-xs text-[var(--muted)]">{result.originalFileName}</p>
            <p className="mt-2 line-clamp-3 text-sm leading-6">{result.textPreview}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function AnswerPanel({
  filters,
  documents,
  answerMode,
  answerQuestion,
  answerResponse,
  selectedCitation,
  selectedCitationId,
  answerError,
  isAnswering,
  onAnswer,
  onAnswerModeChange,
  onAnswerQuestionChange,
  onCitationSelect
}: {
  filters: FilterState;
  documents: StudyDocumentSummary[];
  answerMode: RetrievalMode;
  answerQuestion: string;
  answerResponse: AnswerResponse | null;
  selectedCitation: AnswerCitation | null;
  selectedCitationId: number | null;
  answerError: string | null;
  isAnswering: boolean;
  onAnswer: (event: FormEvent<HTMLFormElement>) => void;
  onAnswerModeChange: (mode: RetrievalMode) => void;
  onAnswerQuestionChange: (question: string) => void;
  onCitationSelect: (citationId: number) => void;
}) {
  return (
    <section className="qn-panel rounded-md">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Ask QuickNotes</h2>
        <MessageSquareText aria-hidden="true" size={18} className="text-[var(--accent)]" />
      </div>
      <form onSubmit={onAnswer} className="flex flex-col gap-3 p-4">
        <div className="grid gap-3 md:grid-cols-[280px_minmax(0,1fr)] md:items-center">
          <div className="qn-segmented grid grid-cols-3 rounded-md p-1" role="radiogroup" aria-label="Answer retrieval mode">
            {searchModeOptions.map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => onAnswerModeChange(option.mode)}
                className={`qn-segment h-9 rounded-sm text-xs font-semibold ${answerMode === option.mode ? "qn-segment-active" : ""}`}
                aria-pressed={answerMode === option.mode}
                disabled={isAnswering}
              >
                {option.label}
              </button>
            ))}
          </div>
          <ActiveScope filters={filters} documents={documents} emptyLabel="All documents" />
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <textarea
            value={answerQuestion}
            onChange={(event) => onAnswerQuestionChange(event.target.value)}
            placeholder="Ask a question about your documents"
            className={`${textAreaClass} min-w-0 flex-1`}
            disabled={isAnswering}
          />
          <button
            type="submit"
            className="qn-primary-button inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 md:self-start"
            disabled={isAnswering}
            title="Ask QuickNotes"
          >
            {isAnswering ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <MessageSquareText aria-hidden="true" size={16} />}
            Ask
          </button>
        </div>
      </form>
      {answerError ? <p className="qn-state-error m-4 rounded-md px-3 py-2 text-sm">{answerError}</p> : null}
      {isAnswering ? (
        <div className="flex items-center gap-2 border-t border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          <Loader2 aria-hidden="true" size={16} className="animate-spin" />
          Answering
        </div>
      ) : null}
      {answerResponse && !isAnswering ? (
        <div className="border-t border-[var(--border)] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <span className="rounded-sm bg-[var(--panel-strong)] px-2 py-1">{answerResponse.retrievalMode}</span>
            <span className="rounded-sm bg-[var(--panel-strong)] px-2 py-1">{answerResponse.model}</span>
            <span>{answerResponse.retrievedChunks.length} chunks retrieved</span>
          </div>
          <ActiveScope filters={answerResponse.filters} documents={documents} />
          {answerResponse.status === "insufficient_evidence" ? (
            <p className="qn-state-warning rounded-md p-3 text-sm leading-6">
              {hasAppliedFilters(answerResponse.filters)
                ? `${answerResponse.answer} The selected filters may be too restrictive.`
                : answerResponse.answer}
            </p>
          ) : (
            <AnswerText answer={answerResponse.answer} citations={answerResponse.citations} onCitationClick={onCitationSelect} />
          )}
          {answerResponse.citations.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {answerResponse.citations.map((citation) => (
                <button
                  key={citation.id}
                  type="button"
                  onClick={() => onCitationSelect(citation.id)}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-semibold ${
                    selectedCitationId === citation.id
                      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                      : "qn-secondary-button"
                  }`}
                >
                  <Quote aria-hidden="true" size={14} />
                  {citation.marker} Page {citation.pageNumber}
                </button>
              ))}
            </div>
          ) : null}
          {selectedCitation ? <CitationReveal citation={selectedCitation} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function DocumentPreviewPanel({
  selectedDocument,
  selectedDocumentId,
  selectedSearchResult,
  content,
  isLoadingContent,
  documentActionId,
  onRetry,
  onDelete
}: {
  selectedDocument: StudyDocumentSummary | null;
  selectedDocumentId: string | null;
  selectedSearchResult: ChunkSearchResult | null;
  content: DocumentContentResponse | null;
  isLoadingContent: boolean;
  documentActionId: string | null;
  onRetry: (document: StudyDocumentSummary) => void;
  onDelete: (document: StudyDocumentSummary) => void;
}) {
  return (
    <section className="qn-panel rounded-md">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{selectedDocument?.title ?? "Extracted chunks"}</h2>
          <p className="mt-1 truncate text-sm text-[var(--muted)]">{selectedDocument?.originalFileName ?? "Select a document"}</p>
        </div>
        {selectedDocument ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <a
              href={`/api/documents/${selectedDocument.id}/source`}
              target="_blank"
              rel="noreferrer"
              className="qn-secondary-button inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold"
              title="Open source PDF"
            >
              <ExternalLink aria-hidden="true" size={14} />
              Source
            </a>
            {selectedDocument.uploadStatus === "FAILED" ? (
              <button
                type="button"
                onClick={() => onRetry(selectedDocument)}
                className="qn-secondary-button inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                disabled={documentActionId === selectedDocument.id}
                title="Retry document processing"
              >
                {documentActionId === selectedDocument.id ? (
                  <Loader2 aria-hidden="true" size={14} className="animate-spin" />
                ) : (
                  <RotateCcw aria-hidden="true" size={14} />
                )}
                Retry
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onDelete(selectedDocument)}
              className="qn-danger-button inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              disabled={documentActionId === selectedDocument.id || selectedDocument.uploadStatus === "DELETING"}
              title="Delete document"
            >
              {documentActionId === selectedDocument.id ? (
                <Loader2 aria-hidden="true" size={14} className="animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" size={14} />
              )}
              Delete
            </button>
            <StatusBadge status={selectedDocument.uploadStatus} />
          </div>
        ) : null}
      </div>

      {selectedSearchResult && selectedSearchResult.documentId === selectedDocumentId ? (
        <article className="border-b border-[var(--border)] bg-[var(--panel-strong)] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <span>Selected search result</span>
            <span className="qn-chip-strong rounded-sm px-2 py-1">Page {selectedSearchResult.pageNumber}</span>
            <span className="qn-chip-strong rounded-sm px-2 py-1">Chunk {selectedSearchResult.chunkIndex}</span>
            <span>{formatPrimaryRanking(selectedSearchResult)}</span>
          </div>
          <div className="mb-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--muted)]">
            {formatRankingBadges(selectedSearchResult).map((badge) => (
              <span key={badge} className="qn-chip-strong rounded-sm px-2 py-1">
                {badge}
              </span>
            ))}
          </div>
          <p className="text-sm leading-6">{selectedSearchResult.textPreview}</p>
        </article>
      ) : null}

      <div className="divide-y divide-[var(--border)]">
        {isLoadingContent ? (
          <div className="flex items-center gap-2 p-5 text-sm text-[var(--muted)]">
            <Loader2 aria-hidden="true" size={16} className="animate-spin" />
            Loading preview
          </div>
        ) : null}
        {!isLoadingContent && !selectedDocument ? <p className="p-5 text-sm text-[var(--muted)]">No document selected.</p> : null}
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
  );
}

function PageTextPanel({ content }: { content: DocumentContentResponse | null }) {
  return (
    <section className="qn-panel rounded-md">
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
  );
}

function MetadataPanel({
  documents,
  selectedDocument,
  metadataForm,
  metadataSaveState,
  metadataSaveMessage,
  onFormChange,
  onSave,
  onDocumentSelect,
  onGoToPdfs
}: {
  documents: StudyDocumentSummary[];
  selectedDocument: StudyDocumentSummary | null;
  metadataForm: MetadataFormState;
  metadataSaveState: MetadataSaveState;
  metadataSaveMessage: string | null;
  onFormChange: Dispatch<SetStateAction<MetadataFormState>>;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onDocumentSelect: (documentId: string) => void;
  onGoToPdfs: () => void;
}) {
  const panelState = getMetadataPanelState(selectedDocument, documents);

  return (
    <section className="qn-panel rounded-md">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-normal text-[var(--muted)]">Metadata</h2>
        <Tags aria-hidden="true" size={17} className="text-[var(--accent)]" />
      </div>
      {panelState === "editor" && selectedDocument ? (
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <form onSubmit={onSave} className="flex min-w-0 flex-col gap-3 text-sm">
            <DocumentSelector documents={documents} selectedDocumentId={selectedDocument.id} onSelect={onDocumentSelect} />
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-normal text-[var(--muted)]">Title</span>
              <input
                value={metadataForm.title}
                onChange={(event) => onFormChange((current) => ({ ...current, title: event.target.value }))}
                className={textInputClass}
                disabled={metadataSaveState === "saving"}
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-normal text-[var(--muted)]">Class</span>
                <input
                  value={metadataForm.className}
                  onChange={(event) => onFormChange((current) => ({ ...current, className: event.target.value }))}
                  className={textInputClass}
                  disabled={metadataSaveState === "saving"}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-normal text-[var(--muted)]">Topic</span>
                <input
                  value={metadataForm.topic}
                  onChange={(event) => onFormChange((current) => ({ ...current, topic: event.target.value }))}
                  className={textInputClass}
                  disabled={metadataSaveState === "saving"}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-normal text-[var(--muted)]">Source</span>
              <input
                value={metadataForm.source}
                onChange={(event) => onFormChange((current) => ({ ...current, source: event.target.value }))}
                className={textInputClass}
                disabled={metadataSaveState === "saving"}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-normal text-[var(--muted)]">Document date</span>
              <input
                value={metadataForm.documentDate}
                onChange={(event) => onFormChange((current) => ({ ...current, documentDate: event.target.value }))}
                type="date"
                className={textInputClass}
                disabled={metadataSaveState === "saving"}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-normal text-[var(--muted)]">Tags</span>
              <input
                value={metadataForm.tags}
                onChange={(event) => onFormChange((current) => ({ ...current, tags: event.target.value }))}
                className={textInputClass}
                disabled={metadataSaveState === "saving"}
              />
            </label>
            <TagPreview tags={splitTags(metadataForm.tags)} />
            <button
              type="submit"
              className="qn-primary-button inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              disabled={metadataSaveState === "saving"}
              title="Save metadata"
            >
              {metadataSaveState === "saving" ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <CheckCircle2 aria-hidden="true" size={16} />}
              Save metadata
            </button>
            {metadataSaveMessage ? (
              <p className={`text-sm ${metadataSaveState === "error" ? "qn-state-error rounded-md px-3 py-2" : "qn-state-success"}`}>
                {metadataSaveMessage}
              </p>
            ) : null}
          </form>
          <aside className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-2 gap-4">
              <MetadataItem label="Pages" value={String(selectedDocument.pageCount ?? 0)} />
              <MetadataItem label="Chunks" value={String(selectedDocument.chunkCount)} />
              <MetadataItem label="Size" value={formatFileSize(selectedDocument.fileSize)} />
              <MetadataItem label="Created" value={formatDate(selectedDocument.createdAt)} />
              <MetadataItem label="Storage" value={selectedDocument.storageProvider} />
              <MetadataItem label="Attempts" value={String(selectedDocument.processingAttemptCount)} />
            </dl>
            {selectedDocument.failureReason ? (
              <p className="qn-state-error rounded-md p-3 text-xs leading-5">
                {selectedDocument.failureStage ? `${selectedDocument.failureStage}: ` : ""}
                {selectedDocument.failureReason}
              </p>
            ) : null}
          </aside>
        </div>
      ) : (
        <MetadataEmptyState documents={documents} onDocumentSelect={onDocumentSelect} onGoToPdfs={onGoToPdfs} />
      )}
    </section>
  );
}

function MetadataEmptyState({
  documents,
  onDocumentSelect,
  onGoToPdfs
}: {
  documents: StudyDocumentSummary[];
  onDocumentSelect: (documentId: string) => void;
  onGoToPdfs: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h3 className="text-lg font-semibold">No document selected</h3>
        <p className="mt-2 text-sm text-[var(--muted)]">Choose a PDF to view and edit its metadata.</p>
      </div>
      {documents.length > 0 ? (
        <DocumentSelector documents={documents} selectedDocumentId={null} onSelect={onDocumentSelect} />
      ) : (
        <button
          type="button"
          onClick={onGoToPdfs}
          className="qn-primary-button inline-flex h-10 w-fit items-center gap-2 rounded-md px-3 text-sm font-semibold"
        >
          <FileText aria-hidden="true" size={16} />
          Go to PDFs
        </button>
      )}
    </div>
  );
}

function DocumentSelector({
  documents,
  selectedDocumentId,
  onSelect
}: {
  documents: StudyDocumentSummary[];
  selectedDocumentId: string | null;
  onSelect: (documentId: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
      Document
      <select
        value={selectedDocumentId ?? ""}
        onChange={(event) => {
          if (event.target.value) {
            onSelect(event.target.value);
          }
        }}
        className={`${textInputClass} font-normal normal-case`}
      >
        <option value="" disabled>
          Select a PDF
        </option>
        {documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetadataFilterControls({
  filters,
  documents,
  options,
  disabled,
  layout = "stacked",
  onChange,
  onClear
}: {
  filters: FilterState;
  documents: StudyDocumentSummary[];
  options: MetadataOptionsResponse;
  disabled: boolean;
  layout?: "stacked" | "compact";
  onChange: (filters: FilterState) => void;
  onClear: () => void;
}) {
  const active = isFilterStateActive(filters);

  function updateList(field: keyof Pick<FilterState, "documentIds" | "classNames" | "topics" | "sources" | "tags">) {
    return (event: ChangeEvent<HTMLSelectElement>) => {
      onChange({
        ...filters,
        [field]: Array.from(event.target.selectedOptions).map((option) => option.value)
      });
    };
  }

  function updateDate(field: keyof Pick<FilterState, "documentDateFrom" | "documentDateTo">) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      onChange({
        ...filters,
        [field]: event.target.value
      });
    };
  }

  return (
    <div className={layout === "compact" ? "grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3 p-4"}>
      <FilterSelect
        label="Documents"
        values={filters.documentIds}
        disabled={disabled}
        onChange={updateList("documentIds")}
        options={documents.map((document) => ({
          value: document.id,
          label: document.title,
          count: document.chunkCount
        }))}
      />
      <FilterSelect label="Classes" values={filters.classNames} disabled={disabled} onChange={updateList("classNames")} options={options.classes} />
      <FilterSelect label="Topics" values={filters.topics} disabled={disabled} onChange={updateList("topics")} options={options.topics} />
      <FilterSelect label="Sources" values={filters.sources} disabled={disabled} onChange={updateList("sources")} options={options.sources} />
      <FilterSelect label="Tags" values={filters.tags} disabled={disabled} onChange={updateList("tags")} options={options.tags} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
          From
          <input
            value={filters.documentDateFrom}
            onChange={updateDate("documentDateFrom")}
            type="date"
            className={`${textInputClass} font-normal normal-case`}
            disabled={disabled}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
          To
          <input
            value={filters.documentDateTo}
            onChange={updateDate("documentDateTo")}
            type="date"
            className={`${textInputClass} font-normal normal-case`}
            disabled={disabled}
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3 md:col-span-2 xl:col-span-3">
        <span className="text-xs font-semibold text-[var(--muted)]">{active ? "Filters active" : "No filters active"}</span>
        <button
          type="button"
          onClick={onClear}
          className="qn-secondary-button inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || !active}
          title="Clear filters"
        >
          <X aria-hidden="true" size={14} />
          Clear
        </button>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  values,
  options,
  disabled,
  onChange
}: {
  label: string;
  values: string[];
  options: Array<{ value: string; count: number; label?: string }>;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
      {label}
      <select
        multiple
        value={values}
        onChange={onChange}
        className="qn-field min-h-24 rounded-md px-2 py-2 text-sm font-normal normal-case outline-none"
        disabled={disabled || options.length === 0}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label ?? option.value} ({option.count})
          </option>
        ))}
      </select>
    </label>
  );
}

function ActiveScope({
  filters,
  documents,
  emptyLabel = "Unfiltered scope"
}: {
  filters: FilterState | AppliedRetrievalFilters;
  documents?: StudyDocumentSummary[];
  emptyLabel?: string;
}) {
  const chips = formatFilterChips(filters, documents ?? []);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
      {chips.length > 0 ? (
        chips.map((chip) => (
          <span key={chip} className="qn-chip rounded-sm px-2 py-1">
            {chip}
          </span>
        ))
      ) : (
        <span className="qn-chip rounded-sm px-2 py-1">{emptyLabel}</span>
      )}
    </div>
  );
}

function TagPreview({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.length > 0 ? (
        tags.map((tag) => (
          <span key={tag} className="qn-chip rounded-sm px-2 py-1 text-xs font-medium">
            {tag}
          </span>
        ))
      ) : (
        <span className="text-xs font-semibold text-[var(--muted)]">No tags</span>
      )}
    </div>
  );
}

function SearchModeNotice({
  metadata,
  selectedMode
}: {
  metadata: Pick<SearchResponse, "requestedMode" | "mode" | "actualMode" | "semantic" | "resultCount" | "ranking">;
  selectedMode: RetrievalMode;
}) {
  if (metadata.semantic.semanticAvailable) {
    return (
      <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
        Using {metadata.actualMode} search. {metadata.resultCount} result{metadata.resultCount === 1 ? "" : "s"}.
      </p>
    );
  }

  if (selectedMode === "keyword") {
    return null;
  }

  const message =
    metadata.semantic.reason === "missing_api_key"
      ? "Semantic search is unavailable because server AI configuration is incomplete. Keyword search still works."
      : `No stored embeddings found for ${metadata.semantic.model}. Run npm run embeddings:backfill after configuring the API key.`;

  return <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">{message}</p>;
}

function AnswerText({
  answer,
  citations,
  onCitationClick
}: {
  answer: string;
  citations: AnswerCitation[];
  onCitationClick: (citationId: number) => void;
}) {
  const citationIds = new Set(citations.map((citation) => citation.id));
  const parts: ReactNode[] = [];
  const markerPattern = /\[(\d+)]/g;
  let cursor = 0;
  let match = markerPattern.exec(answer);

  while (match) {
    const markerStart = match.index;
    const markerEnd = markerStart + match[0].length;
    const citationId = Number.parseInt(match[1], 10);

    if (markerStart > cursor) {
      parts.push(answer.slice(cursor, markerStart));
    }

    if (citationIds.has(citationId)) {
      parts.push(
        <button
          key={`${citationId}-${markerStart}`}
          type="button"
          onClick={() => onCitationClick(citationId)}
          className="mx-0.5 rounded-sm bg-[var(--panel-selected)] px-1.5 py-0.5 text-xs font-semibold text-[var(--accent-strong)] hover:bg-[var(--panel-hover)]"
        >
          {match[0]}
        </button>
      );
    } else {
      parts.push(match[0]);
    }

    cursor = markerEnd;
    match = markerPattern.exec(answer);
  }

  if (cursor < answer.length) {
    parts.push(answer.slice(cursor));
  }

  return <p className="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--control)] p-3 text-sm leading-6">{parts}</p>;
}

function CitationReveal({ citation }: { citation: AnswerCitation }) {
  return (
    <article className="mt-4 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
        <span>{citation.marker}</span>
        <span className="qn-chip-strong rounded-sm px-2 py-1">{citation.documentTitle}</span>
        <span className="qn-chip-strong rounded-sm px-2 py-1">Page {citation.pageNumber}</span>
        <span className="qn-chip-strong rounded-sm px-2 py-1">Rank {citation.retrievalRank}</span>
        <span>Score {formatScore(citation.retrievalScore)}</span>
      </div>
      <p className="mb-2 truncate text-xs text-[var(--muted)]">{citation.documentFileName}</p>
      <p className="whitespace-pre-wrap text-sm leading-6">{citation.sourceText}</p>
    </article>
  );
}

function appendFiltersToSearchParams(parameters: URLSearchParams, filters: FilterState) {
  appendArrayParameters(parameters, "documentId", filters.documentIds);
  appendArrayParameters(parameters, "className", filters.classNames);
  appendArrayParameters(parameters, "topic", filters.topics);
  appendArrayParameters(parameters, "source", filters.sources);
  appendArrayParameters(parameters, "tag", filters.tags);

  if (filters.documentDateFrom) {
    parameters.set("documentDateFrom", filters.documentDateFrom);
  }

  if (filters.documentDateTo) {
    parameters.set("documentDateTo", filters.documentDateTo);
  }
}

function filtersToPayload(filters: FilterState): RetrievalFilters {
  return {
    documentIds: filters.documentIds.length > 0 ? filters.documentIds : undefined,
    classNames: filters.classNames.length > 0 ? filters.classNames : undefined,
    topics: filters.topics.length > 0 ? filters.topics : undefined,
    sources: filters.sources.length > 0 ? filters.sources : undefined,
    tags: filters.tags.length > 0 ? filters.tags : undefined,
    documentDateFrom: filters.documentDateFrom || undefined,
    documentDateTo: filters.documentDateTo || undefined
  };
}

function appendArrayParameters(parameters: URLSearchParams, name: string, values: string[]) {
  for (const value of values) {
    parameters.append(name, value);
  }
}

function splitTags(value: string) {
  const tags = new Map<string, string>();

  for (const rawTag of value.split(",")) {
    const tag = rawTag.normalize("NFKC").trim().replace(/\s+/g, " ");
    const key = tag.toLocaleLowerCase();

    if (tag && !tags.has(key)) {
      tags.set(key, tag);
    }
  }

  return Array.from(tags.values());
}

function isFilterStateActive(filters: FilterState) {
  return (
    filters.documentIds.length > 0 ||
    filters.classNames.length > 0 ||
    filters.topics.length > 0 ||
    filters.sources.length > 0 ||
    filters.tags.length > 0 ||
    Boolean(filters.documentDateFrom) ||
    Boolean(filters.documentDateTo)
  );
}

function hasAppliedFilters(filters: AppliedRetrievalFilters) {
  return (
    filters.documentIds.length > 0 ||
    filters.classNames.length > 0 ||
    filters.topics.length > 0 ||
    filters.sources.length > 0 ||
    filters.tags.length > 0 ||
    Boolean(filters.documentDateFrom) ||
    Boolean(filters.documentDateTo)
  );
}

function formatFilterChips(filters: FilterState | AppliedRetrievalFilters, documents: StudyDocumentSummary[]) {
  const documentTitles = new Map(documents.map((document) => [document.id, document.title]));
  const chips: string[] = [];

  chips.push(...filters.documentIds.map((documentId) => `Doc: ${documentTitles.get(documentId) ?? documentId}`));
  chips.push(...filters.classNames.map((className) => `Class: ${className}`));
  chips.push(...filters.topics.map((topic) => `Topic: ${topic}`));
  chips.push(...filters.sources.map((source) => `Source: ${source}`));
  chips.push(...filters.tags.map((tag) => `Tag: ${tag}`));

  if (filters.documentDateFrom) {
    chips.push(`From: ${filters.documentDateFrom}`);
  }

  if (filters.documentDateTo) {
    chips.push(`To: ${filters.documentDateTo}`);
  }

  return chips;
}

function formatUploadMessage(payload: Partial<DocumentUploadResponse>) {
  const base = `Ready: ${payload.pageCount ?? 0} pages, ${payload.chunkCount ?? 0} chunks.`;

  if (payload.embeddingStatus === "complete") {
    return `${base} Embeddings complete.`;
  }

  if (payload.embeddingStatus === "failed") {
    return `${base} Embeddings failed; run npm run embeddings:backfill after fixing configuration.`;
  }

  if (payload.embeddingStatus === "skipped_missing_api_key") {
    return `${base} Keyword search is available; semantic search needs server AI configuration and backfill.`;
  }

  return base;
}

function formatPrimaryRanking(result: ChunkSearchResult) {
  const label = result.ranking.mode === "hybrid" ? "Final" : result.ranking.mode === "semantic" ? "Semantic" : "Keyword";

  return `${label} rank ${result.rank} / ${formatScore(result.score)}`;
}

function formatRankingBadges(result: ChunkSearchResult) {
  const badges: string[] = [];

  if (result.ranking.keywordRank) {
    badges.push(`Keyword #${result.ranking.keywordRank}`);
  }

  if (typeof result.ranking.semanticSimilarity === "number") {
    badges.push(`Similarity ${formatScore(result.ranking.semanticSimilarity)}`);
  }

  if (result.ranking.semanticRank) {
    badges.push(`Semantic #${result.ranking.semanticRank}`);
  }

  if (result.ranking.mode === "hybrid") {
    badges.unshift(`RRF ${formatScore(result.ranking.finalScore)}`);
  }

  return badges;
}

function StatusBadge({ status }: { status: StudyDocumentUploadStatus }) {
  return <span className={`qn-status-badge shrink-0 rounded-sm px-2 py-1 text-xs font-semibold ${statusStyles[status]}`}>{statusLabels[status]}</span>;
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

function formatScore(score: number) {
  if (!Number.isFinite(score)) {
    return "0";
  }

  return score.toFixed(4);
}
