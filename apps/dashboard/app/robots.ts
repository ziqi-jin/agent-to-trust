import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/playground'],
      },
    ],
    sitemap: 'https://sealit.cc/sitemap.xml',
    host: 'https://sealit.cc',
  };
}
