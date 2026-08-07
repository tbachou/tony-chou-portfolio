const NAV_LINKS = [
  { href: '#about', label: 'About' },
  { href: '#interview', label: 'Interview' },
  { href: '#resume', label: 'Resume' },
  { href: '#contact', label: 'Contact' }
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4 sm:px-8">
        <a href="#top" className="text-sm font-medium tracking-wide text-foreground">
          Tony Chou
        </a>
        <nav aria-label="Section navigation">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="transition-colors hover:text-foreground">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
