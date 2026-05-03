interface CardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export function Card({ title, subtitle, children, className = "" }: CardProps) {
  return (
    <div className={`bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] ${className}`}>
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
  delta?: {
    value: string;
    direction: "up" | "down" | "neutral";
    polarity?: "good" | "bad"; // up could be good (revenue) or bad (risk)
  };
}

const ACCENT_COLORS = {
  blue: "text-[var(--c-accent)]",
  green: "text-[var(--c-success)]",
  red: "text-[var(--c-error)]",
  amber: "text-[var(--c-warning)]",
  default: "text-[var(--c-text-primary)]",
};

export function StatCard({ label, value, sub, accent = "default", delta }: StatCardProps) {
  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] px-6 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)]">
        {label}
      </p>
      <p className={`font-sans text-[3.25rem] leading-none font-extralight tracking-[-0.03em] mt-1 ${ACCENT_COLORS[accent]}`}>
        {value}
      </p>
      {delta && <DeltaIndicator delta={delta} />}
      {sub && (
        <p className="text-xs text-[var(--c-text-tertiary)] mt-2">{sub}</p>
      )}
    </div>
  );
}

function DeltaIndicator({ delta }: { delta: NonNullable<StatCardProps["delta"]> }) {
  const polarity = delta.polarity ?? "good";
  const goodDirections: Record<typeof polarity, "up" | "down"> = { good: "up", bad: "down" };
  const isFavorable = delta.direction === goodDirections[polarity];
  const color = delta.direction === "neutral"
    ? "text-[var(--c-text-tertiary)]"
    : isFavorable
      ? "text-[var(--c-success)]"
      : "text-[var(--c-error)]";
  const arrow = delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "—";
  return (
    <p className={`text-xs font-light tabular-nums mt-2 ${color}`}>
      {delta.value} {arrow}
    </p>
  );
}
