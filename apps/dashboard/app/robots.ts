import type { MetadataRoute } from 'next';

/**
 * robots.txt（2026-10-07 修订）。
 *
 * 变更：放行「数据类 GET」给爬虫——
 *  - 之前 `Disallow: /api/` 把 /api/leaderboard、/api/agents 一起禁了，导致榜单数据
 *    对爬虫不可见（榜单页是客户端渲染，唯一的机器可读出口又被封）。
 *  - 现在只禁写路径与内部端点，放行公开只读数据端点。
 *
 * 仍禁：/playground（自测场，频繁写且无 SEO 价值）、/api/ingest（上报写口）、
 *       一切 POST/write。
 */

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/api/leaderboard', '/api/agents', '/api/agents/'],
        disallow: ['/playground', '/api/ingest', '/api/feedback', '/api/visits'],
      },
    ],
    sitemap: 'https://sealit.cc/sitemap.xml',
    host: 'https://sealit.cc',
  };
}
