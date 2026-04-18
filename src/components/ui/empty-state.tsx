interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="text-[var(--c-text-tertiary)] mb-4">{icon}</div>}
      <h3 className="text-lg font-semibold text-[var(--c-text-primary)]">{title}</h3>
      <p className="text-sm text-[var(--c-text-secondary)] mt-1 max-w-md">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-[var(--c-error-bg)] border border-[var(--c-error-border)] rounded-xl px-6 py-4">
      <p className="text-sm text-[var(--c-error-text)] font-medium">Something went wrong</p>
      <p className="text-sm text-[var(--c-error-text-mid)] mt-1">{message}</p>
    </div>
  );
}

export function LoadingState({ message = "Loading\u2026" }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex items-center gap-3 text-[var(--c-text-secondary)]">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm">{message}</span>
      </div>
    </div>
  );
}
