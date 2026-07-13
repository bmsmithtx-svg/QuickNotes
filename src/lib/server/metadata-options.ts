import type { MetadataOptionsResponse } from "../types";
import type { PrismaTransactionLike } from "./db";

export type MetadataOptionRow = {
  value: string;
  count: number | bigint;
};

export async function getMetadataOptions(db: PrismaTransactionLike): Promise<MetadataOptionsResponse> {
  const [classes, topics, sources, tags] = await Promise.all([
    getDocumentMetadataOptions(db, "className"),
    getDocumentMetadataOptions(db, "topic"),
    getDocumentMetadataOptions(db, "source"),
    getTagOptions(db)
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

async function getDocumentMetadataOptions(db: PrismaTransactionLike, columnName: string) {
  const rows = await db.$queryRawUnsafe<MetadataOptionRow[]>(
    `
      SELECT "${columnName}" AS "value", COUNT(*) AS "count"
      FROM "StudyDocument"
      WHERE "${columnName}" IS NOT NULL
        AND trim("${columnName}") <> ''
      GROUP BY "${columnName}"
      ORDER BY lower("${columnName}") ASC, "${columnName}" ASC
    `
  );

  return mapMetadataOptionRows(rows);
}

async function getTagOptions(db: PrismaTransactionLike) {
  const rows = await db.$queryRawUnsafe<MetadataOptionRow[]>(
    `
      SELECT "tag"."name" AS "value", COUNT(DISTINCT "documentTag"."documentId") AS "count"
      FROM "Tag" AS "tag"
      INNER JOIN "DocumentTag" AS "documentTag"
        ON "documentTag"."tagId" = "tag"."id"
      INNER JOIN "StudyDocument" AS "document"
        ON "document"."id" = "documentTag"."documentId"
      GROUP BY "tag"."id", "tag"."name", "tag"."normalizedName"
      ORDER BY "tag"."normalizedName" ASC, "tag"."name" ASC
    `
  );

  return mapMetadataOptionRows(rows);
}
