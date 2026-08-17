import Link from 'next/link';

export function BackToProjects() {
  return (
    <Link
      href="/#projects"
      className="text-term-sm text-term-muted transition-colors duration-term-instant hover:text-term-ink"
    >
      <span aria-hidden="true">$ </span>
      cd ~/portfolio/projects
    </Link>
  );
}
