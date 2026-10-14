"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";
  const { signIn, register } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    try {
      if (isRegister) {
        await register({
          name: String(form.get("name") ?? "").trim(),
          email,
          password,
          ...(String(form.get("phone") ?? "").trim() ? { phone: String(form.get("phone")).trim() } : {}),
        });
      } else {
        await signIn(email, password);
      }
      router.replace("/dashboard");
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "VALIDATION_ERROR") {
        setError("Please check your details. Passwords need at least 8 characters, including a letter and a number.");
      } else if (reason instanceof ApiError && reason.status === 409) {
        setError("An account with this email already exists. Try signing in instead.");
      } else {
        setError(errorMessage(reason, "We couldn't complete that request."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link href="/" className="brand auth-brand"><span className="brand-mark">CP</span>Career Platform</Link>
        <div>
          <span className="eyebrow">A clearer next step</span>
          <h1>Your career, with a little more direction.</h1>
          <p>Keep your career conversations, resume drafts, and consultation plans together in one private workspace.</p>
        </div>
        <p className="auth-footnote">Thoughtful tools for the work ahead.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">{isRegister ? "START YOUR WORKSPACE" : "WELCOME BACK"}</span>
          <h2>{isRegister ? "Create your account" : "Sign in to Career Platform"}</h2>
          <p className="muted">{isRegister ? "A good next step starts with a clear view." : "Pick up where you left off."}</p>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <form className="form-stack" onSubmit={submit}>
            {isRegister && <label className="field">Full name<input name="name" autoComplete="name" required maxLength={100} placeholder="Jordan Lee" /></label>}
            <label className="field">Email address<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></label>
            {isRegister && <label className="field">Phone <span className="optional">(optional)</span><input name="phone" type="tel" autoComplete="tel" maxLength={15} pattern="\+?[0-9\s-]{7,15}" placeholder="+1 555 010 2000" /></label>}
            <label className="field">Password<input name="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} minLength={isRegister ? 8 : 1} maxLength={72} pattern={isRegister ? "(?=.*[A-Za-z])(?=.*\\d).{8,72}" : undefined} required placeholder={isRegister ? "At least 8 characters" : "Your password"} /></label>
            {isRegister && <p className="field-hint">Use 8–72 characters, including at least one letter and one number.</p>}
            <button className="button button-primary button-full" disabled={submitting}>{submitting ? "Please wait…" : isRegister ? "Create account" : "Sign in"}</button>
          </form>
          <p className="auth-switch">
            {isRegister ? "Already have an account?" : "New to Career Platform?"}{" "}
            <Link href={isRegister ? "/login" : "/register"}>{isRegister ? "Sign in" : "Create an account"}</Link>
          </p>
          <Link className="text-link auth-home-link" href="/">Back to home</Link>
        </div>
      </section>
    </main>
  );
}
