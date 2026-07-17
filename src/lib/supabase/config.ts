export type SupabaseBrowserConfig = {
  url: string;
  publishableKey: string;
};

export function getSupabaseBrowserConfig(env: NodeJS.ProcessEnv = process.env): SupabaseBrowserConfig {
  const url = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requireEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  if (env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("Do not expose the Supabase service-role key through NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY.");
  }

  return {
    url: normalizeSupabaseUrl(url),
    publishableKey
  };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured for Supabase authentication.`);
  }

  return value;
}

function normalizeSupabaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}
