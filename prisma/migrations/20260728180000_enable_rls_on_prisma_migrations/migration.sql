-- Keep Prisma migration metadata out of Supabase's public API surface.
-- Prisma connects as the table owner for migrations, so regular RLS is safe;
-- do not FORCE RLS or migration bookkeeping can be blocked for non-bypass owners.

ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM authenticated;
  END IF;
END
$$;
