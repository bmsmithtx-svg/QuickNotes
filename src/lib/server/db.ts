type PrismaDelegate = {
  findMany: (args?: unknown) => Promise<unknown[]>;
  findUnique: (args: unknown) => Promise<unknown | null>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  createMany: (args: unknown) => Promise<unknown>;
};

export type PrismaTransactionLike = {
  studyDocument: PrismaDelegate;
  documentPage: PrismaDelegate;
  documentChunk: PrismaDelegate;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <Result = unknown>(query: string, ...values: unknown[]) => Promise<Result>;
};

export type PrismaClientLike = PrismaTransactionLike & {
  $transaction: <Result>(callback: (transaction: PrismaTransactionLike) => Promise<Result>) => Promise<Result>;
  $disconnect?: () => Promise<void>;
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientLike;
};

type PrismaClientModule = {
  PrismaClient: new (options?: { datasources?: { db?: { url?: string } } }) => PrismaClientLike;
};

const importRuntimeModule = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<unknown>;

export async function getPrisma() {
  if (!globalForPrisma.prisma) {
    const { PrismaClient } = (await importRuntimeModule("@prisma/client")) as PrismaClientModule;
    const runtimeUrl = getPrismaRuntimeDatabaseUrl();

    globalForPrisma.prisma = runtimeUrl
      ? new PrismaClient({
          datasources: {
            db: {
              url: runtimeUrl
            }
          }
        })
      : new PrismaClient();
  }

  return globalForPrisma.prisma;
}

export function getPrismaRuntimeDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    return undefined;
  }

  return withSupabaseTransactionPoolerCompatibility(databaseUrl);
}

export function withSupabaseTransactionPoolerCompatibility(databaseUrl: string) {
  let url: URL;

  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  if (!isPostgresUrl(url) || !usesSupabaseTransactionPooler(url) || url.searchParams.has("pgbouncer")) {
    return databaseUrl;
  }

  url.searchParams.set("pgbouncer", "true");
  return url.toString();
}

function isPostgresUrl(url: URL) {
  return url.protocol === "postgresql:" || url.protocol === "postgres:";
}

function usesSupabaseTransactionPooler(url: URL) {
  return url.port === "6543" && url.hostname.includes("supabase");
}
