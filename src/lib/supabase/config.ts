export type SupabaseBrowserConfig = {
  url: string;
  publishableKey: string;
};

export class SupabaseConfigurationError extends Error {
  constructor(
    readonly variableName: string,
    message = `${variableName} must be configured for Supabase authentication.`
  ) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

export function getSupabaseBrowserConfig(env?: NodeJS.ProcessEnv): SupabaseBrowserConfig {
  const url = requireEnvValue("NEXT_PUBLIC_SUPABASE_URL", env?.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = requireEnvValue(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );

  if ((env?.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY)?.trim()) {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
      "Do not expose the Supabase service-role key through NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return {
    url: normalizeSupabaseUrl(url),
    publishableKey
  };
}

export function isSupabaseConfigurationError(error: unknown) {
  if (error instanceof SupabaseConfigurationError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "SupabaseConfigurationError" || error.message.includes("NEXT_PUBLIC_SUPABASE");
}

function requireEnvValue(name: string, rawValue: string | undefined) {
  const value = rawValue?.trim();

  if (!value) {
    throw new SupabaseConfigurationError(name);
  }

  return value;
}

export function normalizeSupabaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}
