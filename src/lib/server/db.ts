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
};

export type PrismaClientLike = PrismaTransactionLike & {
  $transaction: <Result>(callback: (transaction: PrismaTransactionLike) => Promise<Result>) => Promise<Result>;
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientLike;
};

type PrismaClientModule = {
  PrismaClient: new () => PrismaClientLike;
};

const importRuntimeModule = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<unknown>;

export async function getPrisma() {
  if (!globalForPrisma.prisma) {
    const { PrismaClient } = (await importRuntimeModule("@prisma/client")) as PrismaClientModule;

    globalForPrisma.prisma = new PrismaClient();
  }

  return globalForPrisma.prisma;
}
