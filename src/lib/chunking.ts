import type { DocumentChunkPreview } from "./types";

export type ChunkPageTextInput = {
  documentId: string;
  pageNumber: number;
  text: string;
  targetCharacters?: number;
  maxCharacters?: number;
  minCharacters?: number;
};

export type DocumentChunkDraft = Omit<DocumentChunkPreview, "id" | "createdAt"> & {
  documentId: string;
};

const DEFAULT_TARGET_CHARACTERS = 1600;
const DEFAULT_MAX_CHARACTERS = 2200;
const DEFAULT_MIN_CHARACTERS = 350;

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function chunkPageText({
  documentId,
  pageNumber,
  text,
  targetCharacters = DEFAULT_TARGET_CHARACTERS,
  maxCharacters = DEFAULT_MAX_CHARACTERS,
  minCharacters = DEFAULT_MIN_CHARACTERS
}: ChunkPageTextInput): DocumentChunkDraft[] {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return [];
  }

  if (normalizedText.length <= maxCharacters) {
    return [
      {
        documentId,
        pageNumber,
        chunkIndex: 0,
        text: normalizedText,
        characterCount: normalizedText.length,
        tokenEstimate: estimateTokens(normalizedText)
      }
    ];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalizedText.length) {
    const end = findChunkEnd(normalizedText, start, targetCharacters, maxCharacters, minCharacters);
    const chunk = normalizedText.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    start = skipLeadingWhitespace(normalizedText, end);
  }

  mergeSmallTrailingChunk(chunks, minCharacters, maxCharacters);

  return chunks.map((chunk, index) => ({
    documentId,
    pageNumber,
    chunkIndex: index,
    text: chunk,
    characterCount: chunk.length,
    tokenEstimate: estimateTokens(chunk)
  }));
}

function findChunkEnd(
  text: string,
  start: number,
  targetCharacters: number,
  maxCharacters: number,
  minCharacters: number
) {
  const remaining = text.length - start;

  if (remaining <= maxCharacters) {
    return text.length;
  }

  const minEnd = Math.min(text.length, start + minCharacters);
  const targetEnd = Math.min(text.length, start + targetCharacters);
  const maxEnd = Math.min(text.length, start + maxCharacters);

  const nextParagraph = findNextParagraphBoundary(text, targetEnd, maxEnd);
  if (nextParagraph !== null) {
    return nextParagraph;
  }

  const previousParagraph = findPreviousParagraphBoundary(text, start, targetEnd, minEnd);
  if (previousParagraph !== null) {
    return previousParagraph;
  }

  const sentence = findPreviousSentenceBoundary(text, start, maxEnd, minEnd);
  if (sentence !== null) {
    return sentence;
  }

  const whitespace = findPreviousWhitespace(text, maxEnd, minEnd);
  if (whitespace !== null) {
    return whitespace;
  }

  return maxEnd;
}

function findNextParagraphBoundary(text: string, from: number, to: number) {
  for (let index = from; index < to - 1; index += 1) {
    if (text[index] === "\n" && text[index + 1] === "\n") {
      return index;
    }
  }

  return null;
}

function findPreviousParagraphBoundary(text: string, start: number, from: number, minEnd: number) {
  for (let index = from; index > start; index -= 1) {
    if (index >= minEnd && text[index - 1] === "\n" && text[index] === "\n") {
      return index - 1;
    }
  }

  return null;
}

function findPreviousSentenceBoundary(text: string, start: number, from: number, minEnd: number) {
  for (let index = from; index > start; index -= 1) {
    const current = text[index - 1];
    const next = text[index];

    if (index >= minEnd && (current === "." || current === "?" || current === "!") && /\s/.test(next ?? "")) {
      return index;
    }
  }

  return null;
}

function findPreviousWhitespace(text: string, from: number, minEnd: number) {
  for (let index = from; index >= minEnd; index -= 1) {
    if (/\s/.test(text[index] ?? "")) {
      return index;
    }
  }

  return null;
}

function skipLeadingWhitespace(text: string, start: number) {
  let index = start;

  while (index < text.length && /\s/.test(text[index] ?? "")) {
    index += 1;
  }

  return index;
}

function mergeSmallTrailingChunk(chunks: string[], minCharacters: number, maxCharacters: number) {
  if (chunks.length < 2) {
    return;
  }

  const last = chunks[chunks.length - 1];
  const previous = chunks[chunks.length - 2];
  const merged = `${previous}\n\n${last}`;

  if (last.length < minCharacters && merged.length <= maxCharacters) {
    chunks.splice(chunks.length - 2, 2, merged);
  }
}
