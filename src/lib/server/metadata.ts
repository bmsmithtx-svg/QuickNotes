import type { AppliedRetrievalFilters, RetrievalFilters } from "../types";

export const MAX_METADATA_TEXT_LENGTH = 160;
export const MAX_TAGS_PER_DOCUMENT = 50;

export type NormalizedTag = {
  name: string;
  normalizedName: string;
};

export type DocumentMetadataUpdate = {
  className?: string | null;
  topic?: string | null;
  source?: string | null;
  documentDate?: Date | null;
  tags?: NormalizedTag[];
};

export type MetadataTagTransaction = {
  tag: {
    upsert: (args: unknown) => Promise<unknown>;
  };
  documentTag: {
    deleteMany: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
};

export type MetadataValidationResult =
  | {
      ok: true;
      value: DocumentMetadataUpdate;
    }
  | {
      ok: false;
      error: string;
    };

export function normalizeNullableText(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string or null.`);
  }

  const normalized = value.normalize("NFKC").trim();
  return normalized || null;
}

export function normalizeTagsInput(value: unknown): NormalizedTag[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("tags must be an array of strings.");
  }

  if (value.length > MAX_TAGS_PER_DOCUMENT) {
    throw new Error(`tags may include at most ${MAX_TAGS_PER_DOCUMENT} values.`);
  }

  const tags = new Map<string, NormalizedTag>();

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("tags must be an array of strings.");
    }

    const name = normalizeTagDisplayName(item);

    if (!name) {
      continue;
    }

    if (name.length > MAX_METADATA_TEXT_LENGTH) {
      throw new Error(`tags must be ${MAX_METADATA_TEXT_LENGTH} characters or fewer.`);
    }

    const normalizedName = normalizeTagName(name);

    if (!tags.has(normalizedName)) {
      tags.set(normalizedName, {
        name,
        normalizedName
      });
    }
  }

  return Array.from(tags.values()).sort((left, right) => left.normalizedName.localeCompare(right.normalizedName));
}

export function normalizeTagDisplayName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeTagName(value: string) {
  return normalizeTagDisplayName(value).toLocaleLowerCase("en-US");
}

export function parseDateOnly(value: unknown, fieldName: string): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(date.getTime()) || formatDateOnly(date) !== value) {
    throw new Error(`${fieldName} must be a valid calendar date.`);
  }

  return date;
}

export function formatDateOnly(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

export function parseDocumentMetadataUpdatePayload(payload: unknown): MetadataValidationResult {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      error: "Request body must be a JSON object."
    };
  }

  const body = payload as Record<string, unknown>;
  const update: DocumentMetadataUpdate = {};

  try {
    if ("className" in body) {
      update.className = validateMetadataText(body.className, "className");
    }

    if ("topic" in body) {
      update.topic = validateMetadataText(body.topic, "topic");
    }

    if ("source" in body) {
      update.source = validateMetadataText(body.source, "source");
    }

    if ("documentDate" in body) {
      update.documentDate = parseDateOnly(body.documentDate, "documentDate");
    }

    if ("tags" in body) {
      update.tags = normalizeTagsInput(body.tags);
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid metadata payload."
    };
  }

  if (Object.keys(update).length === 0) {
    return {
      ok: false,
      error: "At least one metadata field is required."
    };
  }

  return {
    ok: true,
    value: update
  };
}

export function normalizeRetrievalFilters(filters: RetrievalFilters | undefined): AppliedRetrievalFilters {
  const normalized = filters ?? {};
  const documentIds = normalizeStringList(normalized.documentIds, "documentIds");
  const classNames = normalizeStringList(normalized.classNames, "classNames");
  const topics = normalizeStringList(normalized.topics, "topics");
  const sources = normalizeStringList(normalized.sources, "sources");
  const tags = normalizeTagsInput(normalized.tags).map((tag) => tag.name);
  const documentDateFrom = normalizeDateFilter(normalized.documentDateFrom, "documentDateFrom");
  const documentDateTo = normalizeDateFilter(normalized.documentDateTo, "documentDateTo");

  if (documentDateFrom && documentDateTo && documentDateFrom > documentDateTo) {
    throw new Error("documentDateFrom must be on or before documentDateTo.");
  }

  return {
    documentIds,
    classNames,
    topics,
    sources,
    tags,
    documentDateFrom: documentDateFrom ?? undefined,
    documentDateTo: documentDateTo ?? undefined,
    tagMatch: "any"
  };
}

export function mergeRetrievalFilters(...filters: Array<RetrievalFilters | undefined>): RetrievalFilters {
  const merged: RetrievalFilters = {};

  for (const filter of filters) {
    if (!filter) {
      continue;
    }

    merged.documentIds = [...(merged.documentIds ?? []), ...(filter.documentIds ?? [])];
    merged.classNames = [...(merged.classNames ?? []), ...(filter.classNames ?? [])];
    merged.topics = [...(merged.topics ?? []), ...(filter.topics ?? [])];
    merged.sources = [...(merged.sources ?? []), ...(filter.sources ?? [])];
    merged.tags = [...(merged.tags ?? []), ...(filter.tags ?? [])];
    merged.documentDateFrom = filter.documentDateFrom ?? merged.documentDateFrom;
    merged.documentDateTo = filter.documentDateTo ?? merged.documentDateTo;
  }

  return merged;
}

export function serializeNormalizedTags(tags: NormalizedTag[]) {
  return JSON.stringify(tags.map((tag) => tag.name));
}

export async function replaceDocumentTags(
  transaction: MetadataTagTransaction,
  documentId: string,
  tags: NormalizedTag[]
) {
  if (!documentId.trim()) {
    throw new Error("documentId is required before replacing document tags.");
  }

  await transaction.documentTag.deleteMany({
    where: {
      documentId
    }
  });

  for (const tag of tags) {
    const storedTag = (await transaction.tag.upsert({
      where: {
        normalizedName: tag.normalizedName
      },
      update: {
        name: tag.name
      },
      create: {
        name: tag.name,
        normalizedName: tag.normalizedName
      }
    })) as { id: string };

    await transaction.documentTag.create({
      data: {
        documentId,
        tagId: storedTag.id
      }
    });
  }
}

export function isFilterActive(filters: AppliedRetrievalFilters) {
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

function validateMetadataText(value: unknown, fieldName: string) {
  const normalized = normalizeNullableText(value, fieldName);

  if (normalized && normalized.length > MAX_METADATA_TEXT_LENGTH) {
    throw new Error(`${fieldName} must be ${MAX_METADATA_TEXT_LENGTH} characters or fewer.`);
  }

  return normalized;
}

function normalizeStringList(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }

  const values = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`${fieldName} must be an array of strings.`);
    }

    const normalized = item.normalize("NFKC").trim();

    if (normalized) {
      values.add(normalized);
    }
  }

  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function normalizeDateFilter(value: unknown, fieldName: string) {
  const date = parseDateOnly(value, fieldName);
  return formatDateOnly(date);
}
