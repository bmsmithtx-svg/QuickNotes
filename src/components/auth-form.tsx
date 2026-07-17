"use client";

import { Lock, LogIn, Mail, UserPlus } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { submitPasswordAuthForm, verifyAuthenticatedSession, type PasswordAuthMode } from "@/lib/auth/password-auth-flow";
import { createClientAsync } from "@/lib/supabase/client";

export function AuthForm({ reason }: { reason?: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<PasswordAuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(reason ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionActiveRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submissionActiveRef.current) {
      return;
    }

    submissionActiveRef.current = true;

    try {
      await submitPasswordAuthForm({
        mode,
        email,
        password,
        isSubmitting: false,
        createClient: createClientAsync,
        navigation: router,
        ui: {
          setError,
          setMessage,
          setSubmitting: setIsSubmitting
        },
        verifyServerSession: verifyAuthenticatedSession
      });
    } finally {
      submissionActiveRef.current = false;
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center">
        <section className="qn-panel w-full rounded-md">
          <div className="border-b border-[var(--border)] p-5">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-normal">QuickNotes</h1>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">Powered by</p>
              <Image
                src="/smittyai-logo.png"
                alt="SmittyAI"
                width={240}
                height={160}
                priority
                className="h-auto w-full max-w-60 rounded-sm object-contain"
              />
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">{mode === "sign-in" ? "Sign in to continue." : "Create an account."}</p>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
            <div className="qn-segmented grid grid-cols-2 rounded-md p-1" role="radiogroup" aria-label="Authentication mode">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setMode("sign-in");
                  setError(null);
                  setMessage(null);
                }}
                className={`qn-segment inline-flex h-9 items-center justify-center gap-2 rounded-sm text-sm font-semibold ${
                  mode === "sign-in" ? "qn-segment-active" : ""
                }`}
                aria-pressed={mode === "sign-in"}
              >
                <LogIn aria-hidden="true" size={15} />
                Sign in
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setMode("sign-up");
                  setError(null);
                  setMessage(null);
                }}
                className={`qn-segment inline-flex h-9 items-center justify-center gap-2 rounded-sm text-sm font-semibold ${
                  mode === "sign-up" ? "qn-segment-active" : ""
                }`}
                aria-pressed={mode === "sign-up"}
              >
                <UserPlus aria-hidden="true" size={15} />
                Sign up
              </button>
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
              Email
              <span className="qn-field flex h-11 items-center gap-2 rounded-md px-3">
                <Mail aria-hidden="true" size={16} className="text-[var(--muted)]" />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  required
                  disabled={isSubmitting}
                  autoComplete="email"
                  className="min-w-0 flex-1 bg-transparent text-sm font-normal normal-case text-[var(--foreground)] outline-none"
                />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
              Password
              <span className="qn-field flex h-11 items-center gap-2 rounded-md px-3">
                <Lock aria-hidden="true" size={16} className="text-[var(--muted)]" />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  required
                  minLength={6}
                  disabled={isSubmitting}
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  className="min-w-0 flex-1 bg-transparent text-sm font-normal normal-case text-[var(--foreground)] outline-none"
                />
              </span>
            </label>
            <button
              type="submit"
              className="qn-primary-button inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
            >
              {mode === "sign-in" ? <LogIn aria-hidden="true" size={16} /> : <UserPlus aria-hidden="true" size={16} />}
              {isSubmitting ? "Working" : mode === "sign-in" ? "Sign in" : "Sign up"}
            </button>
            {message ? (
              <p role="status" className="qn-state-success text-sm">
                {message}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="qn-state-error rounded-md px-3 py-2 text-sm">
                {error}
              </p>
            ) : null}
          </form>
        </section>
      </div>
    </main>
  );
}
