import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("API authentication boundary", () => {
  it("redirects the signed-out workspace to the auth flow", async () => {
    await withSupabasePublicEnv(async () => {
      const page = await import("../page");

      await assert.rejects(
        () => page.default(),
        (error: unknown) => String((error as { digest?: unknown }).digest ?? error).includes("NEXT_REDIRECT")
      );
    });
  });

  it("returns 401 for unauthenticated private API access", async () => {
    await withSupabasePublicEnv(async () => {
      const listRoute = await import("./documents/list/route");
      const detailRoute = await import("./documents/[id]/route");
      const contentRoute = await import("./documents/[id]/content/route");
      const sourceRoute = await import("./documents/[id]/source/route");
      const retryRoute = await import("./documents/[id]/retry/route");
      const uploadRoute = await import("./documents/upload/route");
      const searchRoute = await import("./search/route");
      const answerRoute = await import("./answer/route");
      const metadataOptionsRoute = await import("./documents/metadata-options/route");
      const context = {
        params: Promise.resolve({
          id: "document-id"
        })
      };
      const checks = [
        listRoute.GET(new Request("http://quicknotes.local/api/documents/list")),
        detailRoute.GET(new Request("http://quicknotes.local/api/documents/document-id"), context),
        contentRoute.GET(new Request("http://quicknotes.local/api/documents/document-id/content"), context),
        sourceRoute.GET(new Request("http://quicknotes.local/api/documents/document-id/source"), context),
        uploadRoute.POST(new Request("http://quicknotes.local/api/documents/upload", { method: "POST" })),
        searchRoute.GET(new Request("http://quicknotes.local/api/search?q=test")),
        answerRoute.POST(new Request("http://quicknotes.local/api/answer", { method: "POST" })),
        metadataOptionsRoute.GET(new Request("http://quicknotes.local/api/documents/metadata-options")),
        detailRoute.PATCH(new Request("http://quicknotes.local/api/documents/document-id", { method: "PATCH" }), context),
        retryRoute.POST(new Request("http://quicknotes.local/api/documents/document-id/retry", { method: "POST" }), context),
        detailRoute.DELETE(new Request("http://quicknotes.local/api/documents/document-id", { method: "DELETE" }), context)
      ];

      for (const responsePromise of checks) {
        await assertUnauthorized(await responsePromise);
      }
    });
  });
});

async function withSupabasePublicEnv(run: () => Promise<void>) {
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-ref.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

    try {
      await run();
    } finally {
      restoreEnv("NEXT_PUBLIC_SUPABASE_URL", previousUrl);
      restoreEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", previousKey);
    }
}

async function assertUnauthorized(response: Response) {
  const body = (await response.json()) as { error?: string };

  assert.equal(response.status, 401);
  assert.equal(body.error, "Authentication required.");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
