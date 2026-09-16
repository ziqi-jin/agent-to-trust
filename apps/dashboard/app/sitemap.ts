import type { MetadataRoute } from 'next';

const BASE = 'https://sealit.cc';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${BASE}/playground`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/contributing`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
  ];
}
