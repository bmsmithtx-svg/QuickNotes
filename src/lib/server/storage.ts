import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const LOCAL_STORAGE_ROOT = path.join(process.cwd(), "storage");
export const PDF_UPLOAD_DIR = path.join(LOCAL_STORAGE_ROOT, "uploads");
export const EXTRACTED_DATA_DIR = path.join(LOCAL_STORAGE_ROOT, "extracted");
export const DOCUMENT_SOURCE_PREFIX = "documents";
export const DEFAULT_LOCAL_STORAGE_BUCKET = "local";
export const SIGNED_SOURCE_URL_TTL_SECONDS = 60;

export type DocumentStorageProvider = "local" | "supabase";

export type StorageConfig =
  | {
      provider: "local";
      bucket: string;
      rootDir: string;
    }
  | {
      provider: "supabase";
      bucket: string;
      supabaseUrl: string;
      serviceRoleKey: string;
    };

export type UploadPdfInput = {
  key: string;
  body: Buffer;
  contentType: string;
  contentSha256?: string | null;
  upsert?: boolean;
};

export type StorageObjectMetadata = {
  key: string;
  size?: number | null;
  contentType?: string | null;
  contentSha256?: string | null;
  updatedAt?: string | null;
};

export type StorageDeleteResult = {
  deleted: boolean;
  missing: boolean;
};

export type ListStorageObjectsOptions = {
  prefix?: string;
  limit?: number;
};

export interface DocumentStorageAdapter {
  provider: DocumentStorageProvider;
  bucket: string;
  uploadPdf(input: UploadPdfInput): Promise<StorageObjectMetadata>;
  readPdf(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  createSignedUrl(key: string, options?: { expiresInSeconds?: number }): Promise<string | null>;
  deleteObject(key: string): Promise<StorageDeleteResult>;
  listObjects(options?: ListStorageObjectsOptions): Promise<StorageObjectMetadata[]>;
}

type SupabaseStorageResponseBody = {
  id?: string;
  name?: string;
  public?: boolean;
  statusCode?: string | number;
  signedURL?: string;
  signedUrl?: string;
  message?: string;
  error?: string;
};

export async function ensureLocalStorage() {
  await mkdir(PDF_UPLOAD_DIR, { recursive: true });
  await mkdir(EXTRACTED_DATA_DIR, { recursive: true });
}

export function getStoredPdfPath(storedFileName: string) {
  return path.join(PDF_UPLOAD_DIR, storedFileName);
}

export function getStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const provider = normalizeStorageProvider(env.QUICKNOTES_STORAGE_PROVIDER);

  if (provider === "local") {
    return {
      provider,
      bucket: env.QUICKNOTES_LOCAL_STORAGE_BUCKET?.trim() || DEFAULT_LOCAL_STORAGE_BUCKET,
      rootDir: path.resolve(env.QUICKNOTES_LOCAL_STORAGE_ROOT?.trim() || PDF_UPLOAD_DIR)
    };
  }

  return getSupabaseStorageConfig(env);
}

export function getSupabaseStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig & { provider: "supabase" } {
  if (env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error(
      "Do not expose the Supabase service-role key through NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY. Use server-only SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  const supabaseUrl = requireEnv(env, "SUPABASE_URL");
  const serviceRoleKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const bucket = requireEnv(env, "SUPABASE_STORAGE_BUCKET");

  return {
    provider: "supabase",
    bucket,
    supabaseUrl: normalizeSupabaseUrl(supabaseUrl),
    serviceRoleKey
  };
}

export function createDocumentStorage(config: StorageConfig = getStorageConfig()): DocumentStorageAdapter {
  if (config.provider === "supabase") {
    return new SupabaseDocumentStorage(config);
  }

  return new LocalDocumentStorage(config);
}

export function getDocumentStorage(env: NodeJS.ProcessEnv = process.env) {
  return createDocumentStorage(getStorageConfig(env));
}

export function getDocumentStorageForRecord(
  record: {
    storageProvider?: string | null;
    storageBucket?: string | null;
  },
  env: NodeJS.ProcessEnv = process.env
) {
  const provider = normalizeStorageProvider(record.storageProvider || env.QUICKNOTES_STORAGE_PROVIDER);

  if (provider === "supabase") {
    const config = getSupabaseStorageConfig(env);

    return createDocumentStorage({
      ...config,
      bucket: record.storageBucket?.trim() || config.bucket
    });
  }

  const config = getStorageConfig({
    ...env,
    QUICKNOTES_STORAGE_PROVIDER: "local"
  });

  return createDocumentStorage({
    ...config,
    bucket: record.storageBucket?.trim() || config.bucket
  });
}

export async function ensureConfiguredStorage(env: NodeJS.ProcessEnv = process.env) {
  const storage = getDocumentStorage(env);

  if (storage.provider === "local") {
    await ensureLocalStorage();

    return {
      provider: storage.provider,
      bucket: storage.bucket,
      created: false,
      existed: true
    };
  }

  return ensureSupabaseStorageBucket(getSupabaseStorageConfig(env));
}

export function createPdfObjectKey() {
  return `${DOCUMENT_SOURCE_PREFIX}/${randomUUID()}.pdf`;
}

export function sha256Hex(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function validateStorageObjectKey(key: string) {
  if (!key.trim()) {
    throw new Error("Storage object key is required.");
  }

  if (key.startsWith("/") || key.includes("\\") || key.split("/").some((segment) => segment === "..")) {
    throw new Error("Storage object key must be a relative object path.");
  }

  return key;
}

export async function ensureSupabaseStorageBucket(config: StorageConfig & { provider: "supabase" }) {
  const client = new SupabaseStorageClient(config);
  const existing = await client.getBucket();

  if (existing.found) {
    if (existing.publicBucket) {
      throw new Error(
        `Supabase Storage bucket "${config.bucket}" exists but is public. Make it private or choose a private bucket.`
      );
    }

    return {
      provider: config.provider,
      bucket: config.bucket,
      existed: true,
      created: false
    };
  }

  await client.createBucket();

  return {
    provider: config.provider,
    bucket: config.bucket,
    existed: false,
    created: true
  };
}

class LocalDocumentStorage implements DocumentStorageAdapter {
  provider = "local" as const;
  bucket: string;
  private rootDir: string;

  constructor(config: StorageConfig & { provider: "local" }) {
    this.bucket = config.bucket;
    this.rootDir = config.rootDir;
  }

  async uploadPdf(input: UploadPdfInput) {
    const key = validateStorageObjectKey(input.key);
    const targetPath = this.resolvePath(key);
    const targetDirectory = path.dirname(targetPath);

    await mkdir(targetDirectory, { recursive: true });

    if (!input.upsert && (await this.exists(key))) {
      throw new Error(`Storage object already exists: ${key}`);
    }

    await writeFile(targetPath, input.body);

    return {
      key,
      size: input.body.byteLength,
      contentType: input.contentType,
      contentSha256: input.contentSha256 ?? sha256Hex(input.body)
    };
  }

  async readPdf(key: string) {
    return readFile(this.resolvePath(validateStorageObjectKey(key)));
  }

  async exists(key: string) {
    try {
      const file = await stat(this.resolvePath(validateStorageObjectKey(key)));

      return file.isFile();
    } catch (error) {
      if (isFileMissingError(error)) {
        return false;
      }

      throw error;
    }
  }

  async createSignedUrl() {
    return null;
  }

  async deleteObject(key: string) {
    try {
      await unlink(this.resolvePath(validateStorageObjectKey(key)));

      return {
        deleted: true,
        missing: false
      };
    } catch (error) {
      if (isFileMissingError(error)) {
        return {
          deleted: false,
          missing: true
        };
      }

      throw error;
    }
  }

  async listObjects(options: ListStorageObjectsOptions = {}) {
    const prefix = options.prefix ?? DOCUMENT_SOURCE_PREFIX;
    const limit = options.limit ?? 1000;
    const results: StorageObjectMetadata[] = [];
    await this.collectObjects(this.rootDir, "", prefix, limit, results);

    return results;
  }

  private resolvePath(key: string) {
    const resolved = path.resolve(this.rootDir, key);
    const root = path.resolve(this.rootDir);

    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error("Storage object key resolves outside the configured storage root.");
    }

    return resolved;
  }

  private async collectObjects(
    directory: string,
    relativeDirectory: string,
    prefix: string,
    limit: number,
    results: StorageObjectMetadata[]
  ) {
    if (results.length >= limit) {
      return;
    }

    let entries: Dirent<string>[];

    try {
      entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if (isFileMissingError(error)) {
        return;
      }

      throw error;
    }

    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await this.collectObjects(fullPath, relativePath, prefix, limit, results);
      } else if (relativePath.startsWith(prefix)) {
        const file = await stat(fullPath);
        results.push({
          key: relativePath,
          size: file.size,
          updatedAt: file.mtime.toISOString()
        });
      }

      if (results.length >= limit) {
        return;
      }
    }
  }
}

class SupabaseDocumentStorage implements DocumentStorageAdapter {
  provider = "supabase" as const;
  bucket: string;
  private client: SupabaseStorageClient;

  constructor(config: StorageConfig & { provider: "supabase" }) {
    this.bucket = config.bucket;
    this.client = new SupabaseStorageClient(config);
  }

  async uploadPdf(input: UploadPdfInput) {
    const key = validateStorageObjectKey(input.key);
    const response = await this.client.fetchObject(key, {
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
        "Cache-Control": "private, max-age=0",
        "x-upsert": input.upsert ? "true" : "false"
      },
      body: input.body as BodyInit
    });

    await ensureOk(response, `upload ${key}`);

    return {
      key,
      size: input.body.byteLength,
      contentType: input.contentType,
      contentSha256: input.contentSha256 ?? sha256Hex(input.body)
    };
  }

  async readPdf(key: string) {
    const safeKey = validateStorageObjectKey(key);
    const response = await this.client.fetchObject(safeKey, {
      method: "GET"
    });

    if (response.status === 404) {
      throw new Error(`Storage object is missing: ${safeKey}`);
    }

    await ensureOk(response, `download ${safeKey}`);

    return Buffer.from(await response.arrayBuffer());
  }

  async exists(key: string) {
    const safeKey = validateStorageObjectKey(key);
    const response = await this.client.fetchObject(safeKey, {
      method: "GET",
      headers: {
        Range: "bytes=0-0"
      }
    });
    const body = response.ok ? null : ((await response.clone().json().catch(() => null)) as SupabaseStorageResponseBody | null);

    if (response.status === 404 || isSupabaseObjectNotFound(response.status, body)) {
      return false;
    }

    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return true;
    }

    await ensureOk(response, `check ${safeKey}`);
    return true;
  }

  async createSignedUrl(key: string, options: { expiresInSeconds?: number } = {}) {
    const safeKey = validateStorageObjectKey(key);
    const response = await this.client.fetchStoragePath(`/object/sign/${this.client.encodedBucket}/${encodeObjectKey(safeKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        expiresIn: options.expiresInSeconds ?? SIGNED_SOURCE_URL_TTL_SECONDS
      })
    });

    await ensureOk(response, `create signed URL for ${safeKey}`);

    const body = (await response.json()) as SupabaseStorageResponseBody;
    const signedUrl = body.signedURL ?? body.signedUrl;

    if (!signedUrl) {
      throw new Error(`Supabase did not return a signed URL for ${safeKey}.`);
    }

    return this.client.toAbsoluteStorageUrl(signedUrl);
  }

  async deleteObject(key: string) {
    const safeKey = validateStorageObjectKey(key);
    const response = await this.client.fetchStoragePath(`/object/${this.client.encodedBucket}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prefixes: [safeKey]
      })
    });

    if (response.status === 404) {
      return {
        deleted: false,
        missing: true
      };
    }

    await ensureOk(response, `delete ${safeKey}`);

    const body = (await response.json().catch(() => [])) as unknown;
    const deleted = Array.isArray(body) ? body.length > 0 : true;

    return {
      deleted,
      missing: !deleted
    };
  }

  async listObjects(options: ListStorageObjectsOptions = {}) {
    const prefix = options.prefix ?? DOCUMENT_SOURCE_PREFIX;
    const limit = options.limit ?? 1000;
    const response = await this.client.fetchStoragePath(`/object/list/${this.client.encodedBucket}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prefix,
        limit,
        offset: 0,
        sortBy: {
          column: "name",
          order: "asc"
        }
      })
    });

    await ensureOk(response, `list objects in ${this.bucket}`);

    const body = (await response.json()) as Array<{
      name?: string;
      updated_at?: string | null;
      metadata?: {
        size?: number | null;
        mimetype?: string | null;
      } | null;
    }>;

    return body
      .map((item) => mapSupabaseListedObject(prefix, item))
      .filter((item): item is StorageObjectMetadata => Boolean(item?.key));
  }
}

class SupabaseStorageClient {
  bucket: string;
  encodedBucket: string;
  private supabaseUrl: string;
  private serviceRoleKey: string;

  constructor(config: StorageConfig & { provider: "supabase" }) {
    this.bucket = config.bucket;
    this.encodedBucket = encodeURIComponent(config.bucket);
    this.supabaseUrl = config.supabaseUrl;
    this.serviceRoleKey = config.serviceRoleKey;
  }

  async getBucket() {
    const response = await this.fetchStoragePath(`/bucket/${this.encodedBucket}`, {
      method: "GET"
    });
    const body = (await response.clone().json().catch(() => null)) as SupabaseStorageResponseBody | null;

    if (response.status === 404 || isSupabaseBucketNotFound(response.status, body)) {
      return {
        found: false,
        publicBucket: false
      };
    }

    await ensureOk(response, `inspect bucket ${this.bucket}`);

    return {
      found: true,
      publicBucket: body?.public === true
    };
  }

  async createBucket() {
    const response = await this.fetchStoragePath("/bucket", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: this.bucket,
        name: this.bucket,
        public: false
      })
    });

    if (response.status === 409) {
      return;
    }

    await ensureOk(response, `create bucket ${this.bucket}`);
  }

  fetchObject(key: string, init: RequestInit) {
    return this.fetchStoragePath(`/object/${this.encodedBucket}/${encodeObjectKey(key)}`, init);
  }

  fetchStoragePath(storagePath: string, init: RequestInit) {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.serviceRoleKey);
    headers.set("Authorization", `Bearer ${this.serviceRoleKey}`);

    return fetch(`${this.supabaseUrl}/storage/v1${storagePath}`, {
      ...init,
      headers
    });
  }

  toAbsoluteStorageUrl(signedUrl: string) {
    if (/^https?:\/\//i.test(signedUrl)) {
      return signedUrl;
    }

    if (signedUrl.startsWith("/storage/v1/")) {
      return `${this.supabaseUrl}${signedUrl}`;
    }

    if (signedUrl.startsWith("/")) {
      return `${this.supabaseUrl}/storage/v1${signedUrl}`;
    }

    return `${this.supabaseUrl}/storage/v1/${signedUrl}`;
  }
}

function normalizeStorageProvider(provider: string | null | undefined): DocumentStorageProvider {
  if (!provider?.trim()) {
    return "local";
  }

  const normalized = provider.trim().toLowerCase();

  if (normalized === "local" || normalized === "supabase") {
    return normalized;
  }

  throw new Error(`QUICKNOTES_STORAGE_PROVIDER must be "local" or "supabase", received "${provider}".`);
}

function normalizeSupabaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function requireEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured for Supabase Storage. Set it in .env.local.`);
  }

  return value;
}

function encodeObjectKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function isFileMissingError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isSupabaseBucketNotFound(status: number, body: SupabaseStorageResponseBody | null) {
  if (status !== 400 || !body) {
    return false;
  }

  const statusCode = String(body.statusCode ?? "");
  const message = `${body.error ?? ""} ${body.message ?? ""}`.toLowerCase();

  return statusCode === "404" && message.includes("bucket not found");
}

function isSupabaseObjectNotFound(status: number, body: SupabaseStorageResponseBody | null) {
  if (status !== 400 || !body) {
    return false;
  }

  const statusCode = String(body.statusCode ?? "");
  const message = `${body.error ?? ""} ${body.message ?? ""}`.toLowerCase();

  return statusCode === "404" && message.includes("not found");
}

async function ensureOk(response: Response, action: string) {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");
  const safeBody = body.replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]").slice(0, 500);

  throw new Error(`Supabase Storage failed to ${action} (HTTP ${response.status}). ${safeBody}`.trim());
}

function mapSupabaseListedObject(
  prefix: string,
  item: {
    name?: string;
    updated_at?: string | null;
    metadata?: {
      size?: number | null;
      mimetype?: string | null;
    } | null;
  }
): StorageObjectMetadata | null {
  if (!item.name) {
    return null;
  }

  const normalizedPrefix = prefix.replace(/\/+$/, "");
  const key = item.name.startsWith(`${normalizedPrefix}/`) || !normalizedPrefix ? item.name : `${normalizedPrefix}/${item.name}`;

  return {
    key,
    size: item.metadata?.size ?? null,
    contentType: item.metadata?.mimetype ?? null,
    updatedAt: item.updated_at ?? null
  };
}
