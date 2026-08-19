import type { Metadata } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import { siteName } from '@/lib/site';
import './beta.css';

// Beta's own face — deliberately not the terminal theme's IBM Plex Mono.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-bricolage',
});

const title = 'Beta — Return-to-Climbing Rehab Planner';
const description =
  'An educational AI planner that drafts a staged return-to-climbing progression for the three most common climbing injuries — with hard safety rails, and nothing you type into the planner ever stored.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/beta' },
  openGraph: {
    title,
    description,
    url: '/beta',
    siteName,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
};

export default function BetaLayout({ children }: { children: React.ReactNode }) {
  return <div className={`beta-theme ${bricolage.variable}`}>{children}</div>;
}
