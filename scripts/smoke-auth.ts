import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "./script-env";

type SmokeAuthUser = {
  id: string;
  email: string;
  accessToken: string;
};

export type SmokeAuthContext = {
  users: SmokeAuthUser[];
  cleanup: () => Promise<void>;
};

export async function createSmokeAuthContext(count: number, label: string): Promise<SmokeAuthContext> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("At least one smoke auth user is required.");
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const publicUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (supabaseUrl.replace(/\/+$/, "") !== publicUrl.replace(/\/+$/, "")) {
    throw new Error("SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL must match for smoke auth.");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  const auth = createClient(publicUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  const createdUsers: SmokeAuthUser[] = [];

  for (let index = 0; index < count; index += 1) {
    const password = `${randomUUID()}aA1!`;
    const email = `quicknotes-smoke-${label}-${index + 1}-${randomUUID()}@example.invalid`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        quicknotes_smoke: label
      }
    });

    if (created.error || !created.data.user?.id) {
      throw new Error(`Could not create smoke auth user ${index + 1}: ${created.error?.message ?? "missing user id"}`);
    }

    const signedIn = await auth.auth.signInWithPassword({
      email,
      password
    });

    if (signedIn.error || !signedIn.data.session?.access_token) {
      await admin.auth.admin.deleteUser(created.data.user.id).catch(() => undefined);
      throw new Error(`Could not sign in smoke auth user ${index + 1}: ${signedIn.error?.message ?? "missing access token"}`);
    }

    createdUsers.push({
      id: created.data.user.id,
      email,
      accessToken: signedIn.data.session.access_token
    });
  }

  return {
    users: createdUsers,
    cleanup: async () => {
      for (const user of createdUsers) {
        await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
      }
    }
  };
}

export function authorizedRequest(input: string, accessToken: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);

  return new Request(input, {
    ...init,
    headers
  });
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for authenticated smoke validation.`);
  }

  return value;
}

function isMainModule() {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

function redactUuid(id: string) {
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

async function runSmokeAuthCli() {
  loadScriptEnv();

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const context = await createSmokeAuthContext(2, `auth-${stamp}`);

  try {
    const distinctUsers = new Set(context.users.map((user) => user.id)).size === context.users.length;

    if (!distinctUsers) {
      throw new Error("Smoke auth users must be distinct.");
    }

    const users = context.users.map((user) => ({
      id: redactUuid(user.id),
      accessTokenIssued: Boolean(user.accessToken)
    }));

    await context.cleanup();

    console.log(
      JSON.stringify(
        {
          ok: true,
          testUsersCreated: users.length,
          signedInUsers: users.filter((user) => user.accessTokenIssued).length,
          distinctUsers,
          users,
          cleanup: {
            usersDeleted: true
          }
        },
        null,
        2
      )
    );
  } catch (error) {
    await context.cleanup();
    throw error;
  }
}

if (isMainModule()) {
  runSmokeAuthCli().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message.replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]") : "Auth smoke test failed."
    );
    process.exitCode = 1;
  });
}
