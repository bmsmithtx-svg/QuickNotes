import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SupabaseConfigurationError } from "../supabase/config";
import { SupabaseRequestTimeoutError } from "../supabase/timeout-fetch";
import {
  AUTH_CONFIRMATION_MESSAGE,
  AUTH_ERROR_MESSAGES,
  AuthSessionVerificationError,
  getUserSafeAuthError,
  submitPasswordAuthForm,
  verifyAuthenticatedSession,
  type PasswordAuthClient,
  type PasswordAuthFormUi,
  type PasswordAuthNavigation,
  type PasswordAuthSubmissionOptions
} from "./password-auth-flow";

describe("password auth flow", () => {
  it("signs in, verifies the server session, and redirects to the workspace", async () => {
    const state = createFlowState();
    let verified = false;
    let seenEmail = "";
    const client = createAuthClient({
      signIn: async (credentials) => {
        seenEmail = credentials.email;
        return {
          data: {
            session: {
              access_token: "token"
            }
          }
        };
      }
    });

    const result = await submitPasswordAuthForm({
      ...baseOptions(state, client),
      email: "  owner@example.com  ",
      verifyServerSession: async () => {
        verified = true;
      }
    });

    assert.equal(result.status, "success");
    assert.equal(seenEmail, "owner@example.com");
    assert.equal(verified, true);
    assert.deepEqual(state.navigationCalls, ["replace:/", "refresh"]);
    assert.deepEqual(state.submitting, [true, false]);
    assert.deepEqual(state.errors, [null]);
  });

  it("returns a safe invalid-credentials error and resets loading", async () => {
    const state = createFlowState();
    const client = createAuthClient({
      signIn: async () => ({
        data: null,
        error: {
          message: "Invalid login credentials"
        }
      })
    });

    const result = await submitPasswordAuthForm(baseOptions(state, client));

    assert.deepEqual(result, {
      status: "failure",
      message: AUTH_ERROR_MESSAGES.invalidCredentials
    });
    assert.equal(state.lastError, AUTH_ERROR_MESSAGES.invalidCredentials);
    assert.deepEqual(state.submitting, [true, false]);
    assert.deepEqual(state.navigationCalls, []);
  });

  it("returns a safe unverified-email error", async () => {
    const state = createFlowState();
    const client = createAuthClient({
      signIn: async () => ({
        data: null,
        error: {
          message: "Email not confirmed"
        }
      })
    });

    const result = await submitPasswordAuthForm(baseOptions(state, client));

    assert.deepEqual(result, {
      status: "failure",
      message: AUTH_ERROR_MESSAGES.unverifiedEmail
    });
    assert.equal(state.lastError, AUTH_ERROR_MESSAGES.unverifiedEmail);
  });

  it("returns a safe missing-configuration error", async () => {
    const state = createFlowState();

    const result = await submitPasswordAuthForm({
      ...baseOptions(state, createAuthClient()),
      createClient: () => {
        throw new SupabaseConfigurationError("NEXT_PUBLIC_SUPABASE_URL");
      }
    });

    assert.deepEqual(result, {
      status: "failure",
      message: AUTH_ERROR_MESSAGES.configuration
    });
    assert.equal(state.lastError, AUTH_ERROR_MESSAGES.configuration);
    assert.deepEqual(state.submitting, [true, false]);
  });

  it("returns a safe timeout error", async () => {
    const state = createFlowState();
    const client = createAuthClient({
      signIn: async () => {
        throw new SupabaseRequestTimeoutError(10);
      }
    });

    const result = await submitPasswordAuthForm(baseOptions(state, client));

    assert.deepEqual(result, {
      status: "failure",
      message: AUTH_ERROR_MESSAGES.timeout
    });
    assert.equal(state.lastError, AUTH_ERROR_MESSAGES.timeout);
  });

  it("returns a safe network error", async () => {
    const state = createFlowState();
    const client = createAuthClient({
      signIn: async () => {
        throw new TypeError("Failed to fetch");
      }
    });

    const result = await submitPasswordAuthForm(baseOptions(state, client));

    assert.deepEqual(result, {
      status: "failure",
      message: AUTH_ERROR_MESSAGES.network
    });
    assert.equal(state.lastError, AUTH_ERROR_MESSAGES.network);
  });

  it("returns a generic safe error for unexpected Supabase failures", async () => {
    const state = createFlowState();
    const client = createAuthClient({
      signIn: async () => ({
        data: null,
        error: {
          message: "database exploded with internal details"
        }
      })
    });

    const result = await submitPasswordAuthForm(baseOptions(state, client));

    assert.deepEqual(result, {
      status: "failure",
      message: AUTH_ERROR_MESSAGES.unexpected
    });
    assert.equal(state.lastError, AUTH_ERROR_MESSAGES.unexpected);
  });

  it("does not start a duplicate submission while a request is active", async () => {
    const state = createFlowState();
    let createCalls = 0;

    const result = await submitPasswordAuthForm({
      ...baseOptions(state, createAuthClient()),
      isSubmitting: true,
      createClient: () => {
        createCalls += 1;
        return createAuthClient();
      }
    });

    assert.deepEqual(result, {
      status: "ignored"
    });
    assert.equal(createCalls, 0);
    assert.deepEqual(state.submitting, []);
  });

  it("shows the confirmation-required message for sign-up without a session", async () => {
    const state = createFlowState();
    const client = createAuthClient({
      signUp: async () => ({
        data: {
          session: null
        }
      })
    });

    const result = await submitPasswordAuthForm({
      ...baseOptions(state, client),
      mode: "sign-up"
    });

    assert.deepEqual(result, {
      status: "confirmation-required"
    });
    assert.equal(state.lastMessage, AUTH_CONFIRMATION_MESSAGE);
    assert.deepEqual(state.navigationCalls, []);
  });

  it("does not redirect when server session verification fails", async () => {
    const state = createFlowState();
    const client = createAuthClient({
      signIn: async () => ({
        data: {
          session: {
            access_token: "token"
          }
        }
      })
    });

    const result = await submitPasswordAuthForm({
      ...baseOptions(state, client),
      verifyServerSession: async () => {
        throw new AuthSessionVerificationError(401);
      }
    });

    assert.deepEqual(result, {
      status: "failure",
      message: AUTH_ERROR_MESSAGES.sessionVerification
    });
    assert.equal(state.lastError, AUTH_ERROR_MESSAGES.sessionVerification);
    assert.deepEqual(state.navigationCalls, []);
  });
});

describe("verifyAuthenticatedSession", () => {
  it("accepts a server-recognized session", async () => {
    await verifyAuthenticatedSession(async () => new Response("{}", { status: 200 }));
  });

  it("rejects a missing server session", async () => {
    await assert.rejects(
      () => verifyAuthenticatedSession(async () => new Response("{}", { status: 401 })),
      (error: unknown) => error instanceof AuthSessionVerificationError && error.status === 401
    );
  });
});

describe("getUserSafeAuthError", () => {
  it("does not expose unexpected error messages", () => {
    assert.equal(getUserSafeAuthError(new Error("stack trace and key abc123")), AUTH_ERROR_MESSAGES.unexpected);
  });
});

type FlowState = {
  errors: Array<string | null>;
  messages: Array<string | null>;
  navigationCalls: string[];
  submitting: boolean[];
  ui: PasswordAuthFormUi;
  navigation: PasswordAuthNavigation;
  readonly lastError: string | null;
  readonly lastMessage: string | null;
};

function createFlowState(): FlowState {
  const state = {
    errors: [] as Array<string | null>,
    messages: [] as Array<string | null>,
    navigationCalls: [] as string[],
    submitting: [] as boolean[],
    ui: {
      setError(message: string | null) {
        state.errors.push(message);
      },
      setMessage(message: string | null) {
        state.messages.push(message);
      },
      setSubmitting(isSubmitting: boolean) {
        state.submitting.push(isSubmitting);
      }
    },
    navigation: {
      replace(path: string) {
        state.navigationCalls.push(`replace:${path}`);
      },
      refresh() {
        state.navigationCalls.push("refresh");
      }
    },
    get lastError() {
      return state.errors.at(-1) ?? null;
    },
    get lastMessage() {
      return state.messages.at(-1) ?? null;
    }
  };

  return state;
}

function baseOptions(state: FlowState, client: PasswordAuthClient): PasswordAuthSubmissionOptions {
  return {
    mode: "sign-in",
    email: "owner@example.com",
    password: "password",
    isSubmitting: false,
    createClient: () => client,
    navigation: state.navigation,
    ui: state.ui
  };
}

type AuthClientOverrides = Partial<PasswordAuthClient["auth"]> & {
  signIn?: PasswordAuthClient["auth"]["signInWithPassword"];
};

function createAuthClient(overrides: AuthClientOverrides = {}): PasswordAuthClient {
  return {
    auth: {
      signInWithPassword:
        overrides.signInWithPassword ??
        overrides.signIn ??
        (async () => ({
          data: {
            session: {
              access_token: "token"
            }
          }
        })),
      signUp:
        overrides.signUp ??
        (async () => ({
          data: {
            session: {
              access_token: "token"
            }
          }
        }))
    }
  };
}
