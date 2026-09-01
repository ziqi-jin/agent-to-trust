import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Agent Credit Lab — Don\'t trust an Agent. Test it.',
  description:
    '公开的 Agent 信用评级档案室：让 100 个 Agent 自主交易，把每一次成交、准时、诚实与否变成可追溯的证据，算出带置信度的信用分。What if every AI agent had a credit score?',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className={`${archivo.variable} ${plexMono.variable}`}>{children}</body>
    </html>
  );
}
