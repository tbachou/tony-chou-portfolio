interface TerminalWindowProps {
  path: string;
  children: React.ReactNode;
  className?: string;
}

export function TerminalWindow({ path, children, className = '' }: TerminalWindowProps) {
  return (
    <div
      className={`w-full rounded-term-md border border-term-border bg-[color:var(--card-bg)] ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-term-border px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full border border-term-border" />
          <span className="h-2.5 w-2.5 rounded-full border border-term-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-term-accent" />
        </span>
        <span className="truncate text-term-xs text-term-muted">{path}</span>
      </div>
      <div className="p-5 sm:p-8">{children}</div>
    </div>
  );
}
