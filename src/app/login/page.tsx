"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--c-page-bg)]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Canopy</h1>
          <p className="text-sm text-[var(--c-text-secondary)] mt-1">Winsome Purchasing Planning</p>
        </div>

        <div className="bg-[var(--c-card-bg)] border border-[var(--c-border)] rounded-xl px-6 py-8 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--c-text-primary)] mb-6">Sign in</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-card-bg)] text-[var(--c-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
                placeholder="you@winsome.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-card-bg)] text-[var(--c-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-sm text-[var(--c-error)] font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 bg-[var(--c-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Signing in\u2026" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
