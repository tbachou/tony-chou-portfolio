import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import { RetroCursor } from '@/components/RetroCursor';
import { siteDescription, siteName, siteUrl } from '@/lib/site';
import './globals.css';
import './terminal.css';

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-ibm-plex-mono'
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteName,
  description: siteDescription,
  keywords: [
    'Tony Chou',
    'Senior Software Engineer',
    'TypeScript',
    'React',
    'Next.js',
    'AI engineer',
    'portfolio'
  ],
  authors: [{ name: 'Tony Chou' }],
  alternates: { canonical: '/' },
  openGraph: {
    title: siteName,
    description: siteDescription,
    url: '/',
    siteName,
    type: 'website',
    locale: 'en_US'
  },
  twitter: {
    card: 'summary_large_image',
    title: siteName,
    description: siteDescription
  },
  robots: {
    index: true,
    follow: true
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`terminal-theme ${ibmPlexMono.variable}`}>
        <div className="terminal-phosphor-glow" aria-hidden="true" />
        <div className="terminal-scanlines" aria-hidden="true" />
        <RetroCursor />
        {children}
      </body>
    </html>
  );
}
