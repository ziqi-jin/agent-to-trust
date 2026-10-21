/**
 * IndexNow 即时收录（2026-10-07，SEO 发现管道 / B 层）。
 *
 * 动机：新域名 + 零权重，光靠 sitemap 等爬虫慢慢发现太慢。IndexNow 协议
 * （Bing / Yandex / Seznam 等共享）允许主动 push URL，秒级进索引队列。
 * 挂在 ingest 成功路径上 → 每次有新 agent 上榜，自动把它的档案页 push 出去，
 * 对「任意上榜 agent」全自动生效，不依赖人工。
 *
 * 红线：
 * - 未设 INDEXNOW_KEY → 整个功能 no-op（不发任何外网请求，测试/本地零副作用）；
 * - 非阻塞 + 全 catch：收录推送失败绝不能拖垮上榜响应（append-only 语义不受影响）；
 * - 只 push 公开档案页（调用方保证 name 来自榜单可见 agent）。
 */

const HOST = 'sealit.cc';
const SITE = 'https://sealit.cc';

export function indexNowKey(): string | null {
  const key = process.env.INDEXNOW_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * 主动提交 URL 到 IndexNow（fire-and-forget 语义；调用方 `void` 掉即可）。
 * 返回 Promise 便于测试断言 fetch 调用；生产路径不 await。
 */
export async function submitIndexNow(
  urls: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const key = indexNowKey();
  if (!key || urls.length === 0) return false;
  try {
    const res = await fetchImpl('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: HOST,
        key,
        keyLocation: `${SITE}/${key}.txt`,
        urlList: urls,
      }),
    });
    // IndexNow 成功返回 200 / 202（202 = 已接受待处理）。
    return res.status === 200 || res.status === 202;
  } catch {
    return false;
  }
}

/** 由 agent 注册名生成其公开档案页绝对 URL（canonical = name 版）。 */
export function agentReportUrl(name: string): string {
  return `${SITE}/agent/${encodeURIComponent(name)}`;
}
