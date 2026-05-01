import Link from "next/link";

interface AlertBannerProps {
  variant: "warning" | "error" | "info";
  title: string;
  description: string;
  href?: string;
  cta?: string;
}

const VARIANT_STYLES: Record<AlertBannerProps["variant"], { bg: string; border: string; iconColor: string; titleColor: string; descColor: string; ctaColor: string }> = {
  warning: {
    bg: "bg-[var(--c-warning-bg)]",
    border: "border-[var(--c-warning-border)]",
    iconColor: "text-[var(--c-warning)]",
    titleColor: "text-[var(--c-warning-text)]",
    descColor: "text-[var(--c-warning-text-alt)]",
    ctaColor: "text-[var(--c-warning-text)]",
  },
  error: {
    bg: "bg-[var(--c-error-bg-light)]",
    border: "border-[var(--c-error-border)]",
    iconColor: "text-[var(--c-error)]",
    titleColor: "text-[var(--c-error-text)]",
    descColor: "text-[var(--c-error-text-mid)]",
    ctaColor: "text-[var(--c-error-text)]",
  },
  info: {
    bg: "bg-[var(--c-info-bg-light)]",
    border: "border-[var(--c-border)]",
    iconColor: "text-[var(--c-accent)]",
    titleColor: "text-[var(--c-text-primary)]",
    descColor: "text-[var(--c-text-secondary)]",
    ctaColor: "text-[var(--c-accent)]",
  },
};

export function AlertBanner({ variant, title, description, href, cta }: AlertBannerProps) {
  const s = VARIANT_STYLES[variant];

  const content = (
    <div className={`flex items-center gap-3 px-5 py-3.5 rounded-xl border ${s.bg} ${s.border}`}>
      <svg className={`w-5 h-5 shrink-0 ${s.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      <div className="min-w-0 flex-1 flex items-baseline gap-2 flex-wrap">
        <span className={`text-sm font-semibold ${s.titleColor}`}>{title}</span>
        <span className={`text-sm ${s.descColor}`}>— {description}</span>
      </div>
      {cta && (
        <span className={`text-sm font-medium whitespace-nowrap shrink-0 ${s.ctaColor}`}>
          {cta} →
        </span>
      )}
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} className="block hover:opacity-95 transition-opacity">
      {content}
    </Link>
  );
}
