"use client";

import { Lock, LogIn, Mail, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ reason }: { reason?: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(reason ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const credentials = {
      email: email.trim(),
      password
    };
    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === "sign-up" && !result.data.session) {
      setMessage("Check your email to confirm your account, then sign in.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center">
        <section className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)]">
          <div className="border-b border-[var(--border)] p-5">
            <h1 className="text-2xl font-semibold tracking-normal">QuickNotes</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">{mode === "sign-in" ? "Sign in to continue." : "Create an account."}</p>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
            <div className="grid grid-cols-2 rounded-md border border-[var(--border)] bg-white p-1" role="radiogroup" aria-label="Authentication mode">
              <button
                type="button"
                onClick={() => {
                  setMode("sign-in");
                  setError(null);
                  setMessage(null);
                }}
                className={`inline-flex h-9 items-center justify-center gap-2 rounded-sm text-sm font-semibold ${
                  mode === "sign-in" ? "bg-[var(--foreground)] text-white" : "text-[var(--muted)]"
                }`}
                aria-pressed={mode === "sign-in"}
              >
                <LogIn aria-hidden="true" size={15} />
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("sign-up");
                  setError(null);
                  setMessage(null);
                }}
                className={`inline-flex h-9 items-center justify-center gap-2 rounded-sm text-sm font-semibold ${
                  mode === "sign-up" ? "bg-[var(--foreground)] text-white" : "text-[var(--muted)]"
                }`}
                aria-pressed={mode === "sign-up"}
              >
                <UserPlus aria-hidden="true" size={15} />
                Sign up
              </button>
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
              Email
              <span className="flex h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3">
                <Mail aria-hidden="true" size={16} className="text-[var(--muted)]" />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  required
                  autoComplete="email"
                  className="min-w-0 flex-1 bg-transparent text-sm font-normal normal-case text-[var(--foreground)] outline-none"
                />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
              Password
              <span className="flex h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3">
                <Lock aria-hidden="true" size={16} className="text-[var(--muted)]" />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  className="min-w-0 flex-1 bg-transparent text-sm font-normal normal-case text-[var(--foreground)] outline-none"
                />
              </span>
            </label>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--foreground)] px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
            >
              {mode === "sign-in" ? <LogIn aria-hidden="true" size={16} /> : <UserPlus aria-hidden="true" size={16} />}
              {isSubmitting ? "Working" : mode === "sign-in" ? "Sign in" : "Sign up"}
            </button>
            {message ? <p className="text-sm text-[var(--success)]">{message}</p> : null}
            {error ? <p className="text-sm text-[#9b1c1c]">{error}</p> : null}
          </form>
        </section>
      </div>
    </main>
  );
}
