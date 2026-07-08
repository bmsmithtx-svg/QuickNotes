import { NOT_FOUND_IN_SOURCES, type SourceCitation, type StudyAnswer, type StudyDocument } from "./types";

export const studyDocuments: StudyDocument[] = [
  {
    id: "ap-bio-cell-transport",
    fileName: "ap-biology-cell-transport.pdf",
    title: "Cell Transport Notes",
    className: "AP Biology",
    topic: "Cells",
    source: "Class notes",
    tags: ["osmosis", "diffusion", "membrane"],
    pageCount: 18,
    uploadedAt: "2026-07-02",
    status: "ready"
  },
  {
    id: "us-history-reconstruction",
    fileName: "us-history-reconstruction-reader.pdf",
    title: "Reconstruction Reader",
    className: "US History",
    topic: "Reconstruction",
    source: "Textbook",
    tags: ["amendments", "civil-war", "primary-source"],
    pageCount: 42,
    uploadedAt: "2026-07-02",
    status: "processing"
  }
];

export const sampleCitations: SourceCitation[] = [
  {
    id: "citation-1",
    fileName: "ap-biology-cell-transport.pdf",
    pageNumber: 7,
    chunkIndex: 3,
    sourceChunk:
      "Osmosis is the movement of water across a selectively permeable membrane from lower solute concentration to higher solute concentration."
  },
  {
    id: "citation-2",
    fileName: "ap-biology-cell-transport.pdf",
    pageNumber: 8,
    chunkIndex: 1,
    sourceChunk:
      "Active transport requires cellular energy because molecules move against their concentration gradient."
  }
];

export const sampleAnswer: StudyAnswer = {
  question: "How is osmosis different from active transport?",
  answer:
    "Osmosis moves water through a selectively permeable membrane along a concentration difference. Active transport uses cellular energy to move molecules against a concentration gradient.",
  retrievalMode: "hybrid",
  citations: sampleCitations,
  supportLevel: "supported"
};

export const unsupportedAnswer: StudyAnswer = {
  question: "What will be on next Friday's quiz?",
  answer: NOT_FOUND_IN_SOURCES,
  retrievalMode: "hybrid",
  citations: [],
  supportLevel: "not_found"
};
