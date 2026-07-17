-- Supabase Auth ownership, user-scoped metadata, and Row-Level Security.
-- Existing production documents must be assigned to exactly one real auth user.
-- If documents exist and auth.users is empty or ambiguous, this migration fails
-- before making ownerId non-null so data is not assigned to an invented owner.

DO $$
BEGIN
  IF to_regnamespace('auth') IS NULL THEN
    CREATE SCHEMA auth;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    IF has_schema_privilege(current_user, 'auth', 'CREATE') THEN
      CREATE TABLE auth.users (
        id UUID PRIMARY KEY
      );
    ELSE
      RAISE EXCEPTION
        'QuickNotes ownership migration requires existing Supabase Auth table auth.users or CREATE privilege on the auth schema.';
    END IF;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    INNER JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
    WHERE pg_namespace.nspname = 'auth'
      AND pg_proc.proname = 'uid'
  ) THEN
    IF has_schema_privilege(current_user, 'auth', 'CREATE') THEN
      CREATE FUNCTION auth.uid()
      RETURNS UUID
      LANGUAGE sql
      STABLE
      AS $function$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
      $function$;
    ELSE
      RAISE EXCEPTION
        'QuickNotes RLS migration requires existing Supabase Auth function auth.uid() or CREATE privilege on the auth schema.';
    END IF;
  END IF;
END
$$;

ALTER TABLE "StudyDocument"
ADD COLUMN IF NOT EXISTS "ownerId" UUID;

ALTER TABLE "Tag"
ADD COLUMN IF NOT EXISTS "ownerId" UUID;

DO $$
DECLARE
  document_count INTEGER;
  tag_count INTEGER;
  auth_user_count INTEGER;
  legacy_owner_id UUID;
BEGIN
  SELECT COUNT(*) INTO document_count FROM "StudyDocument";
  SELECT COUNT(*) INTO tag_count FROM "Tag";

  IF document_count > 0 OR tag_count > 0 THEN
    SELECT COUNT(*)
    INTO auth_user_count
    FROM auth.users;

    IF auth_user_count <> 1 THEN
      RAISE EXCEPTION
        'QuickNotes ownership migration requires exactly one Supabase Auth user to backfill existing rows; found %. Create the legacy owner user first, then rerun migrations.',
        auth_user_count;
    END IF;

    SELECT id
    INTO legacy_owner_id
    FROM auth.users
    LIMIT 1;

    UPDATE "StudyDocument"
    SET "ownerId" = legacy_owner_id
    WHERE "ownerId" IS NULL;

    UPDATE "Tag"
    SET "ownerId" = legacy_owner_id
    WHERE "ownerId" IS NULL;
  END IF;
END
$$;

ALTER TABLE "StudyDocument"
ALTER COLUMN "ownerId" SET NOT NULL;

ALTER TABLE "Tag"
ALTER COLUMN "ownerId" SET NOT NULL;

DROP INDEX IF EXISTS "Tag_normalizedName_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Tag_ownerId_normalizedName_key" ON "Tag"("ownerId", "normalizedName");
CREATE INDEX IF NOT EXISTS "Tag_ownerId_name_idx" ON "Tag"("ownerId", "name");

CREATE INDEX IF NOT EXISTS "StudyDocument_ownerId_createdAt_idx" ON "StudyDocument"("ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "StudyDocument_ownerId_uploadStatus_createdAt_idx" ON "StudyDocument"("ownerId", "uploadStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "StudyDocument_ownerId_className_idx" ON "StudyDocument"("ownerId", "className");
CREATE INDEX IF NOT EXISTS "StudyDocument_ownerId_topic_idx" ON "StudyDocument"("ownerId", "topic");
CREATE INDEX IF NOT EXISTS "StudyDocument_ownerId_source_idx" ON "StudyDocument"("ownerId", "source");
CREATE INDEX IF NOT EXISTS "StudyDocument_ownerId_documentDate_idx" ON "StudyDocument"("ownerId", "documentDate");
CREATE INDEX IF NOT EXISTS "StudyDocument_ownerId_contentSha256_idx" ON "StudyDocument"("ownerId", "contentSha256");
CREATE INDEX IF NOT EXISTS "StudyDocument_ownerId_storageProvider_storageBucket_storageObjectKey_idx"
ON "StudyDocument"("ownerId", "storageProvider", "storageBucket", "storageObjectKey");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "StudyDocument",
  "DocumentPage",
  "DocumentChunk",
  "DocumentChunkEmbedding",
  "Tag",
  "DocumentTag"
TO authenticated;

ALTER TABLE "StudyDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentChunkEmbedding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentTag" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own documents" ON "StudyDocument";
DROP POLICY IF EXISTS "Users can insert own documents" ON "StudyDocument";
DROP POLICY IF EXISTS "Users can update own documents" ON "StudyDocument";
DROP POLICY IF EXISTS "Users can delete own documents" ON "StudyDocument";

CREATE POLICY "Users can select own documents"
ON "StudyDocument"
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId");

CREATE POLICY "Users can insert own documents"
ON "StudyDocument"
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId");

CREATE POLICY "Users can update own documents"
ON "StudyDocument"
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId")
WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId");

CREATE POLICY "Users can delete own documents"
ON "StudyDocument"
FOR DELETE
TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId");

DROP POLICY IF EXISTS "Users can select own document pages" ON "DocumentPage";
DROP POLICY IF EXISTS "Users can insert own document pages" ON "DocumentPage";
DROP POLICY IF EXISTS "Users can update own document pages" ON "DocumentPage";
DROP POLICY IF EXISTS "Users can delete own document pages" ON "DocumentPage";

CREATE POLICY "Users can select own document pages"
ON "DocumentPage"
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentPage"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

CREATE POLICY "Users can insert own document pages"
ON "DocumentPage"
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentPage"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

CREATE POLICY "Users can update own document pages"
ON "DocumentPage"
FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentPage"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentPage"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

CREATE POLICY "Users can delete own document pages"
ON "DocumentPage"
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentPage"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

DROP POLICY IF EXISTS "Users can select own document chunks" ON "DocumentChunk";
DROP POLICY IF EXISTS "Users can insert own document chunks" ON "DocumentChunk";
DROP POLICY IF EXISTS "Users can update own document chunks" ON "DocumentChunk";
DROP POLICY IF EXISTS "Users can delete own document chunks" ON "DocumentChunk";

CREATE POLICY "Users can select own document chunks"
ON "DocumentChunk"
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentChunk"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

CREATE POLICY "Users can insert own document chunks"
ON "DocumentChunk"
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentChunk"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

CREATE POLICY "Users can update own document chunks"
ON "DocumentChunk"
FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentChunk"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentChunk"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

CREATE POLICY "Users can delete own document chunks"
ON "DocumentChunk"
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1
  FROM "StudyDocument"
  WHERE "StudyDocument"."id" = "DocumentChunk"."documentId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

DROP POLICY IF EXISTS "Users can select own chunk embeddings" ON "DocumentChunkEmbedding";
DROP POLICY IF EXISTS "Users can insert own chunk embeddings" ON "DocumentChunkEmbedding";
DROP POLICY IF EXISTS "Users can update own chunk embeddings" ON "DocumentChunkEmbedding";
DROP POLICY IF EXISTS "Users can delete own chunk embeddings" ON "DocumentChunkEmbedding";

CREATE POLICY "Users can select own chunk embeddings"
ON "DocumentChunkEmbedding"
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1
  FROM "DocumentChunk"
  INNER JOIN "StudyDocument" ON "StudyDocument"."id" = "DocumentChunk"."documentId"
  WHERE "DocumentChunk"."id" = "DocumentChunkEmbedding"."chunkId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

CREATE POLICY "Users can insert own chunk embeddings"
ON "DocumentChunkEmbedding"
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1
  FROM "DocumentChunk"
  INNER JOIN "StudyDocument" ON "StudyDocument"."id" = "DocumentChunk"."documentId"
  WHERE "DocumentChunk"."id" = "DocumentChunkEmbedding"."chunkId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

CREATE POLICY "Users can update own chunk embeddings"
ON "DocumentChunkEmbedding"
FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1
  FROM "DocumentChunk"
  INNER JOIN "StudyDocument" ON "StudyDocument"."id" = "DocumentChunk"."documentId"
  WHERE "DocumentChunk"."id" = "DocumentChunkEmbedding"."chunkId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM "DocumentChunk"
  INNER JOIN "StudyDocument" ON "StudyDocument"."id" = "DocumentChunk"."documentId"
  WHERE "DocumentChunk"."id" = "DocumentChunkEmbedding"."chunkId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

CREATE POLICY "Users can delete own chunk embeddings"
ON "DocumentChunkEmbedding"
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1
  FROM "DocumentChunk"
  INNER JOIN "StudyDocument" ON "StudyDocument"."id" = "DocumentChunk"."documentId"
  WHERE "DocumentChunk"."id" = "DocumentChunkEmbedding"."chunkId"
    AND "StudyDocument"."ownerId" = (SELECT auth.uid())
));

DROP POLICY IF EXISTS "Users can select own tags" ON "Tag";
DROP POLICY IF EXISTS "Users can insert own tags" ON "Tag";
DROP POLICY IF EXISTS "Users can update own tags" ON "Tag";
DROP POLICY IF EXISTS "Users can delete own tags" ON "Tag";

CREATE POLICY "Users can select own tags"
ON "Tag"
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId");

CREATE POLICY "Users can insert own tags"
ON "Tag"
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId");

CREATE POLICY "Users can update own tags"
ON "Tag"
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId")
WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId");

CREATE POLICY "Users can delete own tags"
ON "Tag"
FOR DELETE
TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = "ownerId");

DROP POLICY IF EXISTS "Users can select own document tags" ON "DocumentTag";
DROP POLICY IF EXISTS "Users can insert own document tags" ON "DocumentTag";
DROP POLICY IF EXISTS "Users can update own document tags" ON "DocumentTag";
DROP POLICY IF EXISTS "Users can delete own document tags" ON "DocumentTag";

CREATE POLICY "Users can select own document tags"
ON "DocumentTag"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM "StudyDocument"
    WHERE "StudyDocument"."id" = "DocumentTag"."documentId"
      AND "StudyDocument"."ownerId" = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM "Tag"
    WHERE "Tag"."id" = "DocumentTag"."tagId"
      AND "Tag"."ownerId" = (SELECT auth.uid())
  )
);

CREATE POLICY "Users can insert own document tags"
ON "DocumentTag"
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "StudyDocument"
    WHERE "StudyDocument"."id" = "DocumentTag"."documentId"
      AND "StudyDocument"."ownerId" = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM "Tag"
    WHERE "Tag"."id" = "DocumentTag"."tagId"
      AND "Tag"."ownerId" = (SELECT auth.uid())
  )
);

CREATE POLICY "Users can update own document tags"
ON "DocumentTag"
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM "StudyDocument"
    WHERE "StudyDocument"."id" = "DocumentTag"."documentId"
      AND "StudyDocument"."ownerId" = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM "Tag"
    WHERE "Tag"."id" = "DocumentTag"."tagId"
      AND "Tag"."ownerId" = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "StudyDocument"
    WHERE "StudyDocument"."id" = "DocumentTag"."documentId"
      AND "StudyDocument"."ownerId" = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM "Tag"
    WHERE "Tag"."id" = "DocumentTag"."tagId"
      AND "Tag"."ownerId" = (SELECT auth.uid())
  )
);

CREATE POLICY "Users can delete own document tags"
ON "DocumentTag"
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM "StudyDocument"
    WHERE "StudyDocument"."id" = "DocumentTag"."documentId"
      AND "StudyDocument"."ownerId" = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM "Tag"
    WHERE "Tag"."id" = "DocumentTag"."tagId"
      AND "Tag"."ownerId" = (SELECT auth.uid())
  )
);

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "QuickNotes users can select own PDFs" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "QuickNotes users can insert own PDFs" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "QuickNotes users can update own PDFs" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "QuickNotes users can delete own PDFs" ON storage.objects';

    EXECUTE $policy$
      CREATE POLICY "QuickNotes users can select own PDFs"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'quicknotes-pdfs'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "QuickNotes users can insert own PDFs"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'quicknotes-pdfs'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "QuickNotes users can update own PDFs"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'quicknotes-pdfs'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
      )
      WITH CHECK (
        bucket_id = 'quicknotes-pdfs'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "QuickNotes users can delete own PDFs"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'quicknotes-pdfs'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
      )
    $policy$;
  END IF;
END
$$;
