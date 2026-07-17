import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createDocumentStorage,
  createPdfObjectKey,
  ensureSupabaseStorageBucket,
  getSupabaseStorageConfig,
  getStorageConfig,
  sha256Hex
} from "./storage";

describe("document storage adapters", () => {
  it("uploads, reads, checks, and deletes PDFs with the local adapter", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "quicknotes-storage-"));
    const storage = createDocumentStorage({
      provider: "local",
      bucket: "test",
      rootDir
    });
    const body = Buffer.from("%PDF-1.7\nlocal test\n");
    const key = "documents/test.pdf";

    try {
      const uploaded = await storage.uploadPdf({
        key,
        body,
        contentType: "application/pdf"
      });

      assert.equal(uploaded.key, key);
      assert.equal(uploaded.size, body.byteLength);
      assert.equal(uploaded.contentSha256, sha256Hex(body));
      assert.equal(await storage.exists(key), true);
      assert.deepEqual(await storage.readPdf(key), body);
      assert.equal(await storage.createSignedUrl(key), null);

      const listed = await storage.listObjects({ prefix: "documents" });
      assert.deepEqual(listed.map((object) => object.key), [key]);

      assert.deepEqual(await storage.deleteObject(key), { deleted: true, missing: false });
      assert.deepEqual(await storage.deleteObject(key), { deleted: false, missing: true });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("keeps local uploads deterministic by rejecting duplicate keys unless upsert is explicit", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "quicknotes-storage-"));
    const storage = createDocumentStorage({
      provider: "local",
      bucket: "test",
      rootDir
    });

    try {
      await storage.uploadPdf({
        key: "documents/duplicate.pdf",
        body: Buffer.from("%PDF-1.7\nfirst\n"),
        contentType: "application/pdf"
      });

      await assert.rejects(
        () =>
          storage.uploadPdf({
            key: "documents/duplicate.pdf",
            body: Buffer.from("%PDF-1.7\nsecond\n"),
            contentType: "application/pdf"
          }),
        /already exists/
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects storage keys that escape the configured root", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "quicknotes-storage-"));
    const storage = createDocumentStorage({
      provider: "local",
      bucket: "test",
      rootDir
    });

    try {
      await assert.rejects(
        () =>
          storage.uploadPdf({
            key: "../escape.pdf",
            body: Buffer.from("%PDF-1.7\n"),
            contentType: "application/pdf"
          }),
        /relative object path/
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("requires server-only Supabase Storage configuration", () => {
    assert.throws(
      () =>
        getSupabaseStorageConfig({
          ...process.env,
          QUICKNOTES_STORAGE_PROVIDER: "supabase",
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_STORAGE_BUCKET: "quicknotes-pdfs",
          NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "do-not-expose"
        }),
      /Do not expose/
    );

    assert.throws(
      () =>
        getStorageConfig({
          ...process.env,
          QUICKNOTES_STORAGE_PROVIDER: "supabase",
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_STORAGE_BUCKET: "quicknotes-pdfs",
          SUPABASE_SERVICE_ROLE_KEY: ""
        }),
      /SUPABASE_SERVICE_ROLE_KEY/
    );
  });

  it("creates short-lived Supabase signed URLs without exposing browser credentials", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        init: init ?? {}
      });

      return new Response(
        JSON.stringify({
          signedURL: "/object/sign/private/documents/source.pdf?token=signed-token"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    try {
      const storage = createDocumentStorage({
        provider: "supabase",
        bucket: "private",
        supabaseUrl: "https://example.supabase.co",
        serviceRoleKey: "service-role-secret"
      });
      const signedUrl = await storage.createSignedUrl("documents/source.pdf", {
        expiresInSeconds: 30
      });

      assert.equal(
        signedUrl,
        "https://example.supabase.co/storage/v1/object/sign/private/documents/source.pdf?token=signed-token"
      );
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        "https://example.supabase.co/storage/v1/object/sign/private/documents/source.pdf"
      );
      assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer service-role-secret");
      assert.equal(new Headers(calls[0].init.headers).get("apikey"), "service-role-secret");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("recursively lists Supabase owner-scoped PDFs without reporting folder prefixes as objects", async () => {
    const prefixes: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { prefix?: string };
      const prefix = body.prefix ?? "";

      prefixes.push(prefix);

      const items =
        prefix === ""
          ? [{ name: "owner-id", id: null, metadata: null }]
          : prefix === "owner-id"
            ? [{ name: "document-id", id: null, metadata: null }]
            : prefix === "owner-id/document-id"
              ? [
                  {
                    id: "object-id",
                    name: "source.pdf",
                    updated_at: "2026-07-16T00:00:00.000Z",
                    metadata: {
                      size: 12,
                      mimetype: "application/pdf"
                    }
                  }
                ]
              : [];

      return new Response(JSON.stringify(items), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }) as typeof fetch;

    try {
      const storage = createDocumentStorage({
        provider: "supabase",
        bucket: "private",
        supabaseUrl: "https://example.supabase.co",
        serviceRoleKey: "service-role-secret"
      });

      const listed = await storage.listObjects({ prefix: "" });

      assert.deepEqual(prefixes, ["", "owner-id", "owner-id/document-id"]);
      assert.deepEqual(listed, [
        {
          key: "owner-id/document-id/source.pdf",
          size: 12,
          contentType: "application/pdf",
          updatedAt: "2026-07-16T00:00:00.000Z"
        }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("checks Supabase object existence with a ranged GET probe", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        init: init ?? {}
      });

      return new Response("x", {
        status: 206,
        headers: {
          "Content-Type": "application/pdf"
        }
      });
    }) as typeof fetch;

    try {
      const storage = createDocumentStorage({
        provider: "supabase",
        bucket: "private",
        supabaseUrl: "https://example.supabase.co",
        serviceRoleKey: "service-role-secret"
      });

      assert.equal(await storage.exists("documents/source.pdf"), true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://example.supabase.co/storage/v1/object/private/documents/source.pdf");
      assert.equal(calls[0].init.method, "GET");
      assert.equal(new Headers(calls[0].init.headers).get("Range"), "bytes=0-0");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("treats Supabase object 400 not-found bodies as missing objects", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          statusCode: "404",
          error: "Not found",
          message: "Object not found"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )) as typeof fetch;

    try {
      const storage = createDocumentStorage({
        provider: "supabase",
        bucket: "private",
        supabaseUrl: "https://example.supabase.co",
        serviceRoleKey: "service-role-secret"
      });

      assert.equal(await storage.exists("documents/missing.pdf"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates a private Supabase bucket when Storage reports a 400 not-found body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        init: init ?? {}
      });

      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            statusCode: "404",
            error: "Bucket not found",
            message: "Bucket not found"
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      return new Response(JSON.stringify({ name: "private" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }) as typeof fetch;

    try {
      const result = await ensureSupabaseStorageBucket({
        provider: "supabase",
        bucket: "private",
        supabaseUrl: "https://example.supabase.co",
        serviceRoleKey: "service-role-secret"
      });

      assert.deepEqual(result, {
        provider: "supabase",
        bucket: "private",
        existed: false,
        created: true
      });
      assert.equal(calls.length, 2);
      assert.equal(calls[1].url, "https://example.supabase.co/storage/v1/bucket");
      assert.equal(new Headers(calls[1].init.headers).get("Authorization"), "Bearer service-role-secret");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses deterministic owner-scoped object keys that do not depend on the original filename", () => {
    const left = createPdfObjectKey("11111111-1111-4111-8111-111111111111", "doc_1");
    const right = createPdfObjectKey("22222222-2222-4222-8222-222222222222", "doc_1");

    assert.equal(left, "11111111-1111-4111-8111-111111111111/doc_1/source.pdf");
    assert.equal(right, "22222222-2222-4222-8222-222222222222/doc_1/source.pdf");
    assert.notEqual(left, right);
  });
});
