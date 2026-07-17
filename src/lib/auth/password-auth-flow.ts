import { isSupabaseConfigurationError } from "@/lib/supabase/config";
import { createTimeoutFetch, isSupabaseRequestTimeoutError } from "@/lib/supabase/timeout-fetch";

export type PasswordAuthMode = "sign-in" | "sign-up";

export type PasswordAuthCredentials = {
  email: string;
  password: string;
};

export type PasswordAuthResponse = {
  data?: {
    session?: unknown | null;
  } | null;
  error?: unknown;
};

export type PasswordAuthClient = {
  auth: {
    signInWithPassword(credentials: PasswordAuthCredentials): Promise<PasswordAuthResponse>;
    signUp(credentials: PasswordAuthCredentials): Promise<PasswordAuthResponse>;
  };
};

export type PasswordAuthFormUi = {
  setError(message: string | null): void;
  setMessage(message: string | null): void;
  setSubmitting(isSubmitting: boolean): void;
};

export type PasswordAuthNavigation = {
  replace(path: string): void;
  refresh(): void;
};

export type PasswordAuthSubmissionOptions = {
  mode: PasswordAuthMode;
  email: string;
  password: string;
  isSubmitting: boolean;
  createClient(): PasswordAuthClient | Promise<PasswordAuthClient>;
  navigation: PasswordAuthNavigation;
  ui: PasswordAuthFormUi;
  redirectTo?: string;
  verifyServerSession?: () => Promise<void>;
};

export type PasswordAuthSubmissionResult =
  | {
      status: "success";
    }
  | {
      status: "confirmation-required";
    }
  | {
      status: "failure";
      message: string;
    }
  | {
      status: "ignored";
    };

export const AUTH_CONFIRMATION_MESSAGE = "Check your email to confirm your account, then sign in.";

export const AUTH_ERROR_MESSAGES = {
  configuration: "Authentication is temporarily unavailable because the app is missing required public configuration.",
  invalidCredentials: "The email or password is incorrect.",
  network: "Could not reach the authentication service. Check your connection and try again.",
  sessionVerification: "Sign-in succeeded, but the server could not verify your session. Please try again.",
  timeout: "The authentication request timed out. Check your connection and try again.",
  unexpected: "Authentication failed. Please try again.",
  unverifiedEmail: "Confirm your email address before signing in."
} as const;

export class AuthSessionVerificationError extends Error {
  constructor(readonly status: number) {
    super(`Authenticated session verification failed with HTTP ${status}.`);
    this.name = "AuthSessionVerificationError";
  }
}

export async function submitPasswordAuthForm(options: PasswordAuthSubmissionOptions): Promise<PasswordAuthSubmissionResult> {
  if (options.isSubmitting) {
    return {
      status: "ignored"
    };
  }

  options.ui.setError(null);
  options.ui.setMessage(null);
  options.ui.setSubmitting(true);

  try {
    const client = await options.createClient();
    const credentials = {
      email: options.email.trim(),
      password: options.password
    };
    const result =
      options.mode === "sign-in"
        ? await client.auth.signInWithPassword(credentials)
        : await client.auth.signUp(credentials);

    if (result.error) {
      const message = getUserSafeAuthError(result.error);
      options.ui.setError(message);

      return {
        status: "failure",
        message
      };
    }

    if (options.mode === "sign-up" && !result.data?.session) {
      options.ui.setMessage(AUTH_CONFIRMATION_MESSAGE);

      return {
        status: "confirmation-required"
      };
    }

    if (!result.data?.session) {
      options.ui.setError(AUTH_ERROR_MESSAGES.unexpected);

      return {
        status: "failure",
        message: AUTH_ERROR_MESSAGES.unexpected
      };
    }

    await options.verifyServerSession?.();
    options.navigation.replace(options.redirectTo ?? "/");
    options.navigation.refresh();

    return {
      status: "success"
    };
  } catch (error) {
    const message = getUserSafeAuthError(error);
    options.ui.setError(message);

    return {
      status: "failure",
      message
    };
  } finally {
    options.ui.setSubmitting(false);
  }
}

export async function verifyAuthenticatedSession(fetchImpl: typeof fetch = createTimeoutFetch()) {
  const response = await fetchImpl("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new AuthSessionVerificationError(response.status);
  }
}

export function getUserSafeAuthError(error: unknown) {
  if (isSupabaseConfigurationError(error)) {
    return AUTH_ERROR_MESSAGES.configuration;
  }

  if (isSupabaseRequestTimeoutError(error)) {
    return AUTH_ERROR_MESSAGES.timeout;
  }

  if (error instanceof AuthSessionVerificationError) {
    return AUTH_ERROR_MESSAGES.sessionVerification;
  }

  const message = getErrorMessage(error).toLowerCase();
  const name = error instanceof Error ? error.name.toLowerCase() : "";

  if (message.includes("email not confirmed") || message.includes("not confirmed") || message.includes("unverified")) {
    return AUTH_ERROR_MESSAGES.unverifiedEmail;
  }

  if (message.includes("invalid login credentials") || message.includes("invalid credentials")) {
    return AUTH_ERROR_MESSAGES.invalidCredentials;
  }

  if (
    name.includes("fetch") ||
    name.includes("network") ||
    name === "aborterror" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("fetch failed")
  ) {
    return AUTH_ERROR_MESSAGES.network;
  }

  return AUTH_ERROR_MESSAGES.unexpected;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "";
}
