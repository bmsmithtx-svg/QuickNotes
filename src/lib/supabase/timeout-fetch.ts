export const DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS = 15_000;

export class SupabaseRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number = DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS) {
    super(`Supabase request timed out after ${timeoutMs}ms.`);
    this.name = "SupabaseRequestTimeoutError";
  }
}

export function isSupabaseRequestTimeoutError(error: unknown) {
  return error instanceof SupabaseRequestTimeoutError || (error instanceof Error && error.name === "SupabaseRequestTimeoutError");
}

export function createTimeoutFetch(timeoutMs = DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS): typeof fetch {
  return async (input, init = {}) => {
    if (typeof globalThis.fetch !== "function") {
      throw new Error("Fetch is unavailable.");
    }

    const controller = new AbortController();
    const originalSignal = init.signal;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const abortFromOriginalSignal = () => {
      controller.abort(originalSignal?.reason);
    };

    try {
      if (originalSignal?.aborted) {
        throw originalSignal.reason instanceof Error ? originalSignal.reason : new Error("Request aborted.");
      }

      originalSignal?.addEventListener("abort", abortFromOriginalSignal, { once: true });

      return await globalThis.fetch(input, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (timedOut) {
        throw new SupabaseRequestTimeoutError(timeoutMs);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
      originalSignal?.removeEventListener("abort", abortFromOriginalSignal);
    }
  };
}
