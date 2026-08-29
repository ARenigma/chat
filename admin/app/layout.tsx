import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pappal Admin',
  description: 'Pappal founder control plane',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
