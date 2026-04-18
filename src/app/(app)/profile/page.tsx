"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  buyer: "Buyer",
  lead_reviewer: "Lead Reviewer",
  leadership: "Leadership",
};

const DEFAULT_VIEW_OPTIONS = [
  { value: "/", label: "Dashboard" },
  { value: "/import", label: "Import Data" },
  { value: "/skus", label: "SKU Planning" },
  { value: "/containers", label: "Container Planning" },
  { value: "/amazon-doi", label: "Amazon DOI" },
  { value: "/forecast-accuracy", label: "Forecast Accuracy" },
  { value: "/tiers", label: "Tier Management" },
  { value: "/reports", label: "Leadership Reports" },
  { value: "/settings", label: "Settings" },
];

const DATE_FORMAT_OPTIONS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (US)" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (International)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (ISO)" },
];

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  preferences: { defaultView?: string; dateFormat?: string } | null;
  createdAt: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [defaultView, setDefaultView] = useState("/");
  const [dateFormat, setDateFormat] = useState("MM/DD/YYYY");

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data: UserProfile) => {
        setProfile(data);
        setName(data.name);
        setEmail(data.email);
        setDefaultView(data.preferences?.defaultView ?? "/");
        setDateFormat(data.preferences?.dateFormat ?? "MM/DD/YYYY");
      })
      .catch(() => setMessage({ type: "error", text: "Failed to load profile" }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          preferences: { defaultView, dateFormat },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Save failed" });
        return;
      }

      const updated: UserProfile = await res.json();
      setProfile(updated);
      setMessage({ type: "success", text: "Profile updated" });
    } catch {
      setMessage({ type: "error", text: "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Profile</h1>
        <p className="mt-4 text-sm text-[var(--c-text-secondary)]">Loading...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Profile</h1>
        <p className="mt-4 text-sm text-[var(--c-error)]">Could not load profile.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Profile</h1>
      <p className="text-sm text-[var(--c-text-secondary)] mt-1">
        Manage your account settings
      </p>

      <form onSubmit={handleSave} className="mt-6 space-y-6">
        {/* Account Info */}
        <Card title="Account">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-input-bg)] text-[var(--c-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
              />
              <p className="text-xs text-[var(--c-text-tertiary)] mt-1">
                This is also your login username
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-input-bg)] text-[var(--c-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1">
                Role
              </label>
              <div className="px-3 py-2 text-sm bg-[var(--c-page-bg)] border border-[var(--c-border)] rounded-lg text-[var(--c-text-secondary)]">
                {ROLE_LABELS[profile.role] ?? profile.role}
              </div>
              <p className="text-xs text-[var(--c-text-tertiary)] mt-1">
                Role is set by an admin and cannot be changed here
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1">
                Member Since
              </label>
              <div className="px-3 py-2 text-sm text-[var(--c-text-secondary)]">
                {new Date(profile.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
          </div>
        </Card>

        {/* Preferences */}
        <Card title="Preferences">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1">
                Default View After Login
              </label>
              <select
                value={defaultView}
                onChange={(e) => setDefaultView(e.target.value)}
                className="w-full border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-input-bg)] text-[var(--c-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
              >
                {DEFAULT_VIEW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--c-text-tertiary)] mt-1">
                The page you see first after logging in
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1">
                Date Format
              </label>
              <select
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
                className="w-full border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-input-bg)] text-[var(--c-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
              >
                {DATE_FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* Save + Message */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-[var(--c-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>

          {message && (
            <span
              className={`text-sm font-medium ${
                message.type === "success"
                  ? "text-[var(--c-success-text)]"
                  : "text-[var(--c-error)]"
              }`}
            >
              {message.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
