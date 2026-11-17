import type { ReactNode } from 'react';

export const metadata = { title: 'Report review · Stonecutter', description: 'Weekly client report review for marketplace operations' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
