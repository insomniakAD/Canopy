type BadgeVariant = "order" | "watch" | "do_not_order" | "info" | "success" | "warning" | "error" | "neutral";

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  order: "bg-[var(--c-info-bg)] text-[var(--c-info-text)]",
  watch: "bg-[var(--c-warning-bg)] text-[var(--c-warning-text)]",
  do_not_order: "bg-[var(--c-border-row)] text-[var(--c-text-secondary)]",
  info: "bg-[var(--c-info-bg)] text-[var(--c-info-text)]",
  success: "bg-[var(--c-success-bg)] text-[var(--c-success-text)]",
  warning: "bg-[var(--c-warning-bg)] text-[var(--c-warning-text)]",
  error: "bg-[var(--c-error-bg)] text-[var(--c-error-text)]",
  neutral: "bg-[var(--c-border-row)] text-[var(--c-text-body)]",
};

const DECISION_LABELS: Record<string, string> = {
  order: "Order",
  watch: "Watch",
  do_not_order: "Do Not Order",
};

interface BadgeProps {
  variant: BadgeVariant;
  children?: React.ReactNode;
}

export function Badge({ variant, children }: BadgeProps) {
  const label = children ?? DECISION_LABELS[variant] ?? variant;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${VARIANT_STYLES[variant]}`}>
      {label}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<string, BadgeVariant> = {
    overdue: "error",
    urgent: "warning",
    normal: "info",
    low: "neutral",
  };
  return <Badge variant={map[urgency] ?? "neutral"}>{urgency}</Badge>;
}

export function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, BadgeVariant> = { A: "info", B: "warning", C: "neutral" };
  return <Badge variant={map[tier] ?? "neutral"}>Tier {tier}</Badge>;
}
