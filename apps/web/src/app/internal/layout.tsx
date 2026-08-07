import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './terminal.css';

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-ibm-plex-mono'
});

export const metadata: Metadata = {
  title: 'Internal',
  robots: { index: false, follow: false }
};

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`terminal-theme ${ibmPlexMono.variable}`}>
      <div className="terminal-scanlines" aria-hidden="true" />
      {children}
    </div>
  );
}
