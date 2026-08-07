interface TerminalWindowProps {
  path: string;
  children: React.ReactNode;
}

export function TerminalWindow({ path, children }: TerminalWindowProps) {
  return (
    <div className="mx-auto w-full max-w-3xl sm:my-16 sm:rounded-term-md sm:border sm:border-term-border">
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
