import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import { siteDescription, siteName, siteUrl } from '@/lib/site';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
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
    // suppressHydrationWarning: the pre-paint script below stamps
    // data-theme on <html>, so the client markup legitimately differs
    // from what the server rendered. It applies to this element's
    // attributes only, not to the tree beneath it.
    // data-scroll-behavior: globals.css sets `html { scroll-behavior:
    // smooth }` for anchor jumps. Next 15 silently forced that to `auto`
    // during route transitions; Next 16 stopped, so without this attribute
    // a nav click smooth-scrolls the whole page instead of landing at the
    // top instantly. Opting back in keeps navigation feeling instant while
    // in-page anchors stay smooth.
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {/* Must stay a blocking inline script in <head>: it has to run
            before first paint to avoid a flash of the wrong theme.
            next/script, a client provider, or a useEffect all run after
            the browser has already painted. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`terminal-theme ${ibmPlexMono.variable}`}>
        <div className="terminal-phosphor-glow" aria-hidden="true" />
        <div className="terminal-scanlines" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
