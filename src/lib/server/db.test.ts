import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withSupabaseTransactionPoolerCompatibility } from "./db";

describe("Prisma runtime database URL", () => {
  it("leaves local PostgreSQL URLs unchanged", () => {
    const url = "postgresql://quicknotes:quicknotes@localhost:54322/quicknotes?schema=public";

    assert.equal(withSupabaseTransactionPoolerCompatibility(url), url);
  });

  it("enables PgBouncer compatibility for Supabase transaction pooler URLs", () => {
    const url = "postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres?schema=public";
    const transformed = withSupabaseTransactionPoolerCompatibility(url);

    assert.equal(new URL(transformed).searchParams.get("pgbouncer"), "true");
    assert.equal(new URL(transformed).searchParams.get("schema"), "public");
  });

  it("does not duplicate an explicit PgBouncer setting", () => {
    const url = "postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

    assert.equal(withSupabaseTransactionPoolerCompatibility(url), url);
  });
});
