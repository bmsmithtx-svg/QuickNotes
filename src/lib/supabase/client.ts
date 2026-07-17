"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseBrowserConfig } from "./config";

export function createClient() {
  const config = getSupabaseBrowserConfig();

  return createBrowserClient(config.url, config.publishableKey);
}
