import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata = {
  title: 'Report review · Stonecutter',
  description: 'Check weekly marketplace figures against publisher records before a client report is sent.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">Stonecutter <span>· Client report review</span></Link>
            <span className="muted small">Marketplace operations</span>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
