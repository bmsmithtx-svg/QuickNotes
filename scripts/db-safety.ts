export type DatabaseTarget = {
  kind: "unset" | "invalid" | "local" | "supabase" | "remote";
  host: string | null;
  port: string | null;
  database: string | null;
  schema: string | null;
  isTestDatabase: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function describeDatabaseTarget(databaseUrl = process.env.DATABASE_URL): DatabaseTarget {
  if (!databaseUrl?.trim()) {
    return {
      kind: "unset",
      host: null,
      port: null,
      database: null,
      schema: null,
      isTestDatabase: false
    };
  }

  let url: URL;

  try {
    url = new URL(databaseUrl);
  } catch {
    return {
      kind: "invalid",
      host: null,
      port: null,
      database: null,
      schema: null,
      isTestDatabase: false
    };
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const schema = url.searchParams.get("schema");
  const isTestDatabase = /(^|[_-])test($|[_-])/i.test(database) || /(^|[_-])test($|[_-])/i.test(schema ?? "");

  return {
    kind: getDatabaseKind(url),
    host: url.hostname || null,
    port: url.port || null,
    database: database || null,
    schema,
    isTestDatabase
  };
}

export function getDestructivePrismaAction(args: string[]) {
  const [command, subcommand] = args;

  if (command === "migrate" && subcommand === "reset") {
    return "prisma migrate reset";
  }

  if (command === "db" && subcommand === "push" && args.includes("--force-reset")) {
    return "prisma db push --force-reset";
  }

  if (command === "db" && subcommand === "push" && args.includes("--accept-data-loss")) {
    return "prisma db push --accept-data-loss";
  }

  return null;
}

export function assertDatabaseAllowsDestructiveAction(
  env: NodeJS.ProcessEnv,
  action: string,
  databaseUrl = env.DATABASE_URL
) {
  const target = describeDatabaseTarget(databaseUrl);

  if (target.kind === "local") {
    return;
  }

  if (
    target.isTestDatabase &&
    env.QUICKNOTES_TEST_DATABASE === "1" &&
    env.QUICKNOTES_ALLOW_DESTRUCTIVE_DB === "1"
  ) {
    return;
  }

  throw new Error(
    `${action} is blocked for ${formatDatabaseTarget(target)}. Use a local disposable database, or set QUICKNOTES_TEST_DATABASE=1 and QUICKNOTES_ALLOW_DESTRUCTIVE_DB=1 for an isolated test database whose database or schema name contains "test".`
  );
}

export function assertIntegrationTestDatabaseIsIsolated(env: NodeJS.ProcessEnv, databaseUrl = env.DATABASE_URL) {
  const target = describeDatabaseTarget(databaseUrl);

  if (target.kind === "unset") {
    return;
  }

  if (target.kind === "local") {
    return;
  }

  if (target.isTestDatabase && env.QUICKNOTES_TEST_DATABASE === "1") {
    return;
  }

  throw new Error(
    `Integration tests are blocked for ${formatDatabaseTarget(target)}. Configure a local test database, or set QUICKNOTES_TEST_DATABASE=1 with a database or schema name containing "test".`
  );
}

export function formatDatabaseTarget(target: DatabaseTarget) {
  if (target.kind === "unset") {
    return "an unset database URL";
  }

  if (target.kind === "invalid") {
    return "an invalid database URL";
  }

  const parts = [target.kind, target.host ?? "unknown-host"];

  if (target.port) {
    parts.push(`port ${target.port}`);
  }

  if (target.database) {
    parts.push(`database ${target.database}`);
  }

  if (target.schema) {
    parts.push(`schema ${target.schema}`);
  }

  return parts.join(" ");
}

function getDatabaseKind(url: URL): DatabaseTarget["kind"] {
  if (LOCAL_HOSTS.has(url.hostname)) {
    return "local";
  }

  if (url.hostname.includes("supabase")) {
    return "supabase";
  }

  return "remote";
}
