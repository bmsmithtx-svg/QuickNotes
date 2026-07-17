import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getSupabaseBrowserConfig } from "@/lib/supabase/config";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { createTimeoutFetch } from "@/lib/supabase/timeout-fetch";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

export type AuthenticatedRequestResult =
  | {
      ok: true;
      user: AuthenticatedUser;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export class AuthenticationError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function requireAuthenticatedUser(request?: Request): Promise<AuthenticatedUser> {
  const accessToken = getBearerToken(request);
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> | ReturnType<typeof createTokenVerifierClient>;

  try {
    supabase = accessToken ? createTokenVerifierClient() : await createServerSupabaseClient();
  } catch (error) {
    if (isMissingRequestScopeError(error)) {
      throw new AuthenticationError();
    }

    throw error;
  }

  const { data, error } = await supabase.auth.getClaims(accessToken ?? undefined);
  const claims = data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  if (error || !userId) {
    throw new AuthenticationError();
  }

  return {
    id: userId,
    email: typeof claims?.email === "string" ? claims.email : null
  };
}

export function isAuthenticationError(error: unknown) {
  return error instanceof AuthenticationError;
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { error: "Authentication required." },
    {
      status: 401,
      headers: privateNoStoreHeaders()
    }
  );
}

export async function getAuthenticatedUserOrUnauthorized(request?: Request): Promise<AuthenticatedRequestResult> {
  try {
    return {
      ok: true,
      user: await requireAuthenticatedUser(request)
    } satisfies AuthenticatedRequestResult;
  } catch (error) {
    if (isAuthenticationError(error)) {
      return {
        ok: false,
        response: unauthorizedResponse()
      } satisfies AuthenticatedRequestResult;
    }

    throw error;
  }
}

function createTokenVerifierClient() {
  const config = getSupabaseBrowserConfig();

  return createSupabaseClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global: {
      fetch: createTimeoutFetch()
    }
  });
}

function getBearerToken(request: Request | undefined) {
  const authorization = request?.headers.get("authorization")?.trim();

  if (!authorization) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const token = match?.[1]?.trim();

  return token || null;
}

function isMissingRequestScopeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return message.includes("outside a request scope") || message.includes("outside request scope");
}

export function privateNoStoreHeaders() {
  return {
    "Cache-Control": "private, no-store"
  };
}

export function privateJson<T>(body: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");

  return NextResponse.json(body, {
    ...init,
    headers
  });
}
