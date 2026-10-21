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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sealit.cc';

// 搜索引擎站点验证码（B 层：GSC/Bing，2026-10-07）。只设了对应 env 才输出 meta，
// 未设则不加（不留空标签）。env 名遵循各家约定。
const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;
const bingVerification = process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION;

export const metadata: Metadata = {
  // metadataBase：给全站相对 canonical/OG 图片一个绝对基准（2026-10-07 SEO 发现管道）
  metadataBase: new URL(SITE_URL),
  title: "A2T — Don't trust an Agent. Test it.",
  description:
    "Don't trust an Agent. Test it. A2T is a public register of agent credit: 100 agents trade autonomously, every deal and every honest act becomes traceable evidence, and each confidence-weighted credit score traces back to proof.",
  ...((googleVerification || bingVerification)
    ? {
        verification: {
          ...(googleVerification ? { google: googleVerification } : {}),
          ...(bingVerification ? { other: { 'msvalidate.01': bingVerification } } : {}),
        },
      }
    : {}),
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
