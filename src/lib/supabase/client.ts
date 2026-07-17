"use client";

import { createBrowserClient } from "@supabase/ssr";

import {
  getSupabaseBrowserConfig,
  isSupabaseConfigurationError,
  normalizeSupabaseUrl,
  SupabaseConfigurationError,
  type SupabaseBrowserConfig
} from "./config";
import { createTimeoutFetch } from "./timeout-fetch";

export function createClient(config: SupabaseBrowserConfig = getSupabaseBrowserConfig()) {
  return createBrowserClient(config.url, config.publishableKey, {
    global: {
      fetch: createTimeoutFetch()
    }
  });
}

export async function createClientAsync() {
  return createClient(await loadSupabaseBrowserConfig());
}

export async function loadSupabaseBrowserConfig(fetchImpl: typeof fetch = createTimeoutFetch()): Promise<SupabaseBrowserConfig> {
  try {
    return getSupabaseBrowserConfig();
  } catch (error) {
    if (!isSupabaseConfigurationError(error) || typeof window === "undefined") {
      throw error;
    }
  }

  const response = await fetchImpl("/api/auth/config", {
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new SupabaseConfigurationError("NEXT_PUBLIC_SUPABASE_URL", "Supabase public configuration is unavailable.");
  }

  const body = (await response.json()) as Partial<SupabaseBrowserConfig>;

  if (!body.url?.trim() || !body.publishableKey?.trim()) {
    throw new SupabaseConfigurationError("NEXT_PUBLIC_SUPABASE_URL", "Supabase public configuration is incomplete.");
  }

  return {
    url: normalizeSupabaseUrl(body.url),
    publishableKey: body.publishableKey
  };
}
