interface PageHeaderProps {
  title: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between mb-8 pb-5 border-b border-[var(--c-border)]">
      <h1 className="text-3xl font-medium text-[var(--c-text-primary)] tracking-tight">
        {title}
      </h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
