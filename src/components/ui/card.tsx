interface CardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export function Card({ title, subtitle, children, className = "" }: CardProps) {
  return (
    <div className={`bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] shadow-sm ${className}`}>
      {(title || subtitle) && (
        <div className="px-6 py-4 border-b border-[var(--c-border)]">
          {title && <h2 className="text-base font-semibold text-[var(--c-text-primary)]">{title}</h2>}
          {subtitle && <p className="text-sm text-[var(--c-text-secondary)] mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="px-6 py-4">{children}</div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "blue" | "green" | "red" | "amber" | "default";
}

const ACCENT_COLORS = {
  blue: "text-[var(--c-accent)]",
  green: "text-[var(--c-success)]",
  red: "text-[var(--c-error)]",
  amber: "text-[var(--c-warning)]",
  default: "text-[var(--c-text-primary)]",
};

export function StatCard({ label, value, sub, accent = "default" }: StatCardProps) {
  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] shadow-sm px-6 py-5">
      <p className="text-sm text-[var(--c-text-secondary)] font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${ACCENT_COLORS[accent]}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--c-text-tertiary)] mt-1">{sub}</p>}
    </div>
  );
}
