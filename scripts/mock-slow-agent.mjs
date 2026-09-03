/**
 * 慢速 chat-completions mock（playground 压测用"被测 agent"）。
 * 每请求延迟 DELAY_MS 后返回含数字的报价（无 accept）→ 对局每轮耗时 DELAY_MS，
 * 保证压测期间坑位被持续占用。监听 0.0.0.0，走宿主机公网 IP 访问（SSRF 防护只拦私网/环回）。
 *
 * 用法：MOCK_DELAY_MS=3000 MOCK_PORT=18443 node scripts/mock-slow-agent.mjs
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 18443);
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 3000);

let served = 0;
const server = http.createServer((req, res) => {
  const t0 = Date.now();
  setTimeout(() => {
    served++;
    res.writeHead(200, { 'content-type': 'application/json' });
    // 报 72：对手开价 90 让步，agent 不 accept → 拖满轮数，坑位占用最大化
    res.end(JSON.stringify({ choices: [{ message: { content: `我的报价 72` } }] }));
    if (served % 20 === 0) console.log(`[mock] served=${served} last=${Date.now() - t0}ms`);
  }, DELAY_MS);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock] slow agent on :${PORT}, delay=${DELAY_MS}ms`);
});
