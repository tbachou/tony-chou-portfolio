import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tony Chou — Interactive Portfolio',
  description:
    'An interactive portfolio featuring an AI-driven interview about Tony Chou’s engineering work — Product Forge, Mailchimp, Topstep, and more — plus resume, about, and contact.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
