import type { MetadataOptionsResponse } from "../types";
import type { PrismaTransactionLike } from "./db";
import { addSqlParameter } from "./sql";

export type MetadataOptionRow = {
  value: string;
  count: number | bigint;
};

export async function getMetadataOptions(db: PrismaTransactionLike, ownerId?: string): Promise<MetadataOptionsResponse> {
  const [classes, topics, sources, tags] = await Promise.all([
    getDocumentMetadataOptions(db, "className", ownerId),
    getDocumentMetadataOptions(db, "topic", ownerId),
    getDocumentMetadataOptions(db, "source", ownerId),
    getTagOptions(db, ownerId)
  ]);

  return {
    classes,
    topics,
    sources,
    tags
  };
}

export function mapMetadataOptionRows(rows: MetadataOptionRow[]) {
  return rows.map((row) => ({
    value: row.value,
    count: Number(row.count)
  }));
}

async function getDocumentMetadataOptions(db: PrismaTransactionLike, columnName: string, ownerId?: string) {
  const parameters: unknown[] = [];
  const ownerClause = ownerId?.trim()
    ? `AND "ownerId" = ${addSqlParameter(parameters, ownerId.trim())}::uuid`
    : "";
  const rows = await db.$queryRawUnsafe<MetadataOptionRow[]>(
    `
      SELECT "${columnName}" AS "value", COUNT(*) AS "count"
      FROM "StudyDocument"
      WHERE "${columnName}" IS NOT NULL
        AND trim("${columnName}") <> ''
        ${ownerClause}
      GROUP BY "${columnName}"
      ORDER BY lower("${columnName}") ASC, "${columnName}" ASC
    `,
    ...parameters
  );

  return mapMetadataOptionRows(rows);
}

async function getTagOptions(db: PrismaTransactionLike, ownerId?: string) {
  const parameters: unknown[] = [];
  const ownerClause = ownerId?.trim()
    ? `AND "document"."ownerId" = ${addSqlParameter(parameters, ownerId.trim())}::uuid
       AND "tag"."ownerId" = ${addSqlParameter(parameters, ownerId.trim())}::uuid`
    : `AND "tag"."ownerId" = "document"."ownerId"`;
  const rows = await db.$queryRawUnsafe<MetadataOptionRow[]>(
    `
      SELECT "tag"."name" AS "value", COUNT(DISTINCT "documentTag"."documentId") AS "count"
      FROM "Tag" AS "tag"
      INNER JOIN "DocumentTag" AS "documentTag"
        ON "documentTag"."tagId" = "tag"."id"
      INNER JOIN "StudyDocument" AS "document"
        ON "document"."id" = "documentTag"."documentId"
      WHERE 1 = 1
        ${ownerClause}
      GROUP BY "tag"."id", "tag"."name", "tag"."normalizedName"
      ORDER BY "tag"."normalizedName" ASC, "tag"."name" ASC
    `,
    ...parameters
  );

  return mapMetadataOptionRows(rows);
}
