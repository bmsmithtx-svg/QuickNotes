import type { AppliedRetrievalFilters, RetrievalFilters } from "../types";
import { formatDateOnly, normalizeRetrievalFilters, normalizeTagName } from "./metadata";

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
    filters.push(`${qualifiedDocument}."documentDate" >= ?`);
    parameters.push(dateStart(appliedFilters.documentDateFrom));
  }

  if (appliedFilters.documentDateTo) {
    filters.push(`${qualifiedDocument}."documentDate" <= ?`);
    parameters.push(dateEnd(appliedFilters.documentDateTo));
  }

  if (appliedFilters.tags.length > 0) {
    const tagLinkAlias = options.tagLinkAlias ?? "filterDocumentTag";
    const tagAlias = options.tagAlias ?? "filterTag";
    const tagKeys = appliedFilters.tags.map(normalizeTagName);
    const placeholders = tagKeys.map(() => "?").join(", ");

    filters.push(
      `EXISTS (` +
        `SELECT 1 FROM "DocumentTag" AS "${tagLinkAlias}" ` +
        `INNER JOIN "Tag" AS "${tagAlias}" ON "${tagAlias}"."id" = "${tagLinkAlias}"."tagId" ` +
        `WHERE "${tagLinkAlias}"."documentId" = ${qualifiedDocument}."id" ` +
        `AND "${tagAlias}"."normalizedName" IN (${placeholders})` +
        `)`
    );
    parameters.push(...tagKeys);
  }
}

export function tagJsonSelect(documentAlias = "document") {
  const qualifiedDocument = `"${documentAlias}"`;

  return `COALESCE((
          SELECT json_group_array("orderedTags"."name")
          FROM (
            SELECT "tag"."name" AS "name"
            FROM "DocumentTag" AS "documentTag"
            INNER JOIN "Tag" AS "tag"
              ON "tag"."id" = "documentTag"."tagId"
            WHERE "documentTag"."documentId" = ${qualifiedDocument}."id"
            ORDER BY "tag"."normalizedName" ASC
          ) AS "orderedTags"
        ), ${qualifiedDocument}."tags")`;
}

function appendStringListSql(filters: string[], parameters: unknown[], columnSql: string, values: string[]) {
  if (values.length === 0) {
    return;
  }

  if (values.length === 1) {
    filters.push(`${columnSql} = ?`);
    parameters.push(values[0]);
    return;
  }

  filters.push(`${columnSql} IN (${values.map(() => "?").join(", ")})`);
  parameters.push(...values);
}

function dateStart(value: string) {
  return new Date(`${formatDateOnly(value)}T00:00:00.000Z`);
}

function dateEnd(value: string) {
  return new Date(`${formatDateOnly(value)}T23:59:59.999Z`);
}
