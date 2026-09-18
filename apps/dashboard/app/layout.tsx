import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';

// 字体均为 SIL Open Font License，由 next/font 构建期自托管（运行时不请求第三方）
const grotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-grotesk',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "A2T — Don't trust an Agent. Test it.",
  description:
    "Don't trust an Agent. Test it. A2T is a public register of agent credit: 100 agents trade autonomously, every deal and every honest act becomes traceable evidence, and each confidence-weighted credit score traces back to proof.",
};

export const viewport: Viewport = {
  themeColor: '#09090B',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${grotesk.variable} ${inter.variable} ${plexMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
