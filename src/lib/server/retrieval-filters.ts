import type { AppliedRetrievalFilters, RetrievalFilters } from "../types";
import { formatDateOnly, normalizeRetrievalFilters, normalizeTagName } from "./metadata";
import { addSqlParameter, addSqlParameterList } from "./sql";

export type RetrievalFilterSqlOptions = {
  documentAlias?: string;
  tagLinkAlias?: string;
  tagAlias?: string;
};

export function getAppliedRetrievalFilters(input: {
  filters?: RetrievalFilters;
  documentId?: string;
  documentIds?: string[];
  className?: string;
  topic?: string;
  tag?: string;
}) {
  return normalizeRetrievalFilters({
    documentIds: [...(input.documentId ? [input.documentId] : []), ...(input.documentIds ?? []), ...(input.filters?.documentIds ?? [])],
    classNames: [...(input.className ? [input.className] : []), ...(input.filters?.classNames ?? [])],
    topics: [...(input.topic ? [input.topic] : []), ...(input.filters?.topics ?? [])],
    sources: input.filters?.sources,
    tags: [...(input.tag ? [input.tag] : []), ...(input.filters?.tags ?? [])],
    documentDateFrom: input.filters?.documentDateFrom,
    documentDateTo: input.filters?.documentDateTo
  });
}

export function appendRetrievalFilterSql(
  filters: string[],
  parameters: unknown[],
  appliedFilters: AppliedRetrievalFilters,
  options: RetrievalFilterSqlOptions = {}
) {
  const documentAlias = options.documentAlias ?? "document";
  const qualifiedDocument = `"${documentAlias}"`;

  appendStringListSql(filters, parameters, `${qualifiedDocument}."id"`, appliedFilters.documentIds);
  appendStringListSql(filters, parameters, `${qualifiedDocument}."className"`, appliedFilters.classNames);
  appendStringListSql(filters, parameters, `${qualifiedDocument}."topic"`, appliedFilters.topics);
  appendStringListSql(filters, parameters, `${qualifiedDocument}."source"`, appliedFilters.sources);

  if (appliedFilters.documentDateFrom) {
    filters.push(`${qualifiedDocument}."documentDate" >= ${addSqlParameter(parameters, dateOnly(appliedFilters.documentDateFrom))}::date`);
  }

  if (appliedFilters.documentDateTo) {
    filters.push(`${qualifiedDocument}."documentDate" <= ${addSqlParameter(parameters, dateOnly(appliedFilters.documentDateTo))}::date`);
  }

  if (appliedFilters.tags.length > 0) {
    const tagLinkAlias = options.tagLinkAlias ?? "filterDocumentTag";
    const tagAlias = options.tagAlias ?? "filterTag";
    const tagKeys = appliedFilters.tags.map(normalizeTagName);
    const placeholders = addSqlParameterList(parameters, tagKeys);

    filters.push(
      `EXISTS (` +
        `SELECT 1 FROM "DocumentTag" AS "${tagLinkAlias}" ` +
        `INNER JOIN "Tag" AS "${tagAlias}" ON "${tagAlias}"."id" = "${tagLinkAlias}"."tagId" ` +
        `WHERE "${tagLinkAlias}"."documentId" = ${qualifiedDocument}."id" ` +
        `AND "${tagAlias}"."ownerId" = ${qualifiedDocument}."ownerId" ` +
        `AND "${tagAlias}"."normalizedName" IN (${placeholders})` +
        `)`
    );
  }
}

export function appendOwnerFilterSql(
  filters: string[],
  parameters: unknown[],
  ownerId: string | undefined,
  options: Pick<RetrievalFilterSqlOptions, "documentAlias"> = {}
) {
  if (!ownerId?.trim()) {
    return;
  }

  const documentAlias = options.documentAlias ?? "document";
  filters.push(`"${documentAlias}"."ownerId" = ${addSqlParameter(parameters, ownerId.trim())}::uuid`);
}

export function tagJsonSelect(documentAlias = "document") {
  const qualifiedDocument = `"${documentAlias}"`;

  return `COALESCE((
          SELECT json_agg("orderedTags"."name" ORDER BY "orderedTags"."normalizedName")::text
          FROM (
            SELECT "tag"."name" AS "name", "tag"."normalizedName" AS "normalizedName"
            FROM "DocumentTag" AS "documentTag"
            INNER JOIN "Tag" AS "tag"
              ON "tag"."id" = "documentTag"."tagId"
            WHERE "documentTag"."documentId" = ${qualifiedDocument}."id"
              AND "tag"."ownerId" = ${qualifiedDocument}."ownerId"
          ) AS "orderedTags"
        ), ${qualifiedDocument}."tags")`;
}

function appendStringListSql(filters: string[], parameters: unknown[], columnSql: string, values: string[]) {
  if (values.length === 0) {
    return;
  }

  if (values.length === 1) {
    filters.push(`${columnSql} = ${addSqlParameter(parameters, values[0])}`);
    return;
  }

  filters.push(`${columnSql} IN (${addSqlParameterList(parameters, values)})`);
}

function dateOnly(value: string) {
  const formatted = formatDateOnly(value);

  if (!formatted) {
    throw new Error("Invalid retrieval date filter.");
  }

  return formatted;
}
