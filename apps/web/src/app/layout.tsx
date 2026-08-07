import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import { RetroCursor } from '@/components/RetroCursor';
import './globals.css';
import './terminal.css';

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-ibm-plex-mono'
});

export const metadata: Metadata = {
  title: 'Tony Chou — Interactive Portfolio',
  description:
    'An interactive portfolio featuring an AI-driven interview about Tony Chou’s engineering work — Product Forge, Mailchimp, Topstep, and more — plus resume, about, and contact.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`terminal-theme ${ibmPlexMono.variable}`}>
        <div className="terminal-scanlines" aria-hidden="true" />
        <RetroCursor />
        {children}
      </body>
    </html>
  );
}
