import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tony Chou — Interactive Portfolio',
  description:
    'A 3D interactive interview room showcasing Tony Chou’s engineering work — Product Forge, Mailchimp, Topstep, and more.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
