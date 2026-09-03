/**
 * Playground 队列压测（0903：老大问"压测过吗"→ 没，现在压）。
 *
 * 三波并发提交（每请求不同 XFF = 模拟不同真实用户）：
 *   wave1 20 个 → 预期 6 running + 14 queued
 *   wave2 60 个 → 预期把等待队列填到 60 上限（部分 503）
 *   wave3 30 个 → 预期全部 503（队列满）
 * 全程监控：/credit/api/health 延迟（压测期间公开接口是否稳）、api 容器内存。
 * 收尾抽样 GET queued 会话验证 queuePosition 正确性 + 60 用户轮询风暴 30s。
 *
 * 用法：node scripts/loadtest-playground.mjs \
 *         --base http://127.0.0.1/credit/api \
 *         --endpoint http://43.128.85.77:18443/v1/chat/completions
 */
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = get('--base', 'http://127.0.0.1/credit/api');
const ENDPOINT = get('--endpoint', 'http://43.128.85.77:18443/v1/chat/completions');
const HOST = get('--host', 'reeftavern.cc');
const CONTAINER = get('--container', 'agent-credit-lab-api-1');

const waves = [
  { n: 20, prefix: '9.10.0' },
  { n: 60, prefix: '9.10.1' },
  { n: 30, prefix: '9.10.2' },
];

const stats = { total: 0, running: 0, queued: 0, r503: 0, r429: 0, c400: 0, other: 0 };
const queuedIds = [];
const postLat = [];
const otherErrs = [];

async function post(ip) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/playground/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        host: HOST,
      },
      body: JSON.stringify({
        name: `load-${ip.replace(/[.]/g, '-')}`,
        endpoint: ENDPOINT,
        scenario: { templateId: 'neg-keyboard-price' },
      }),
    });
    const ms = Date.now() - t0;
    const body = await res.json().catch(() => ({}));
    stats.total++;
    postLat.push(ms);
    if (res.status === 201 && body.status === 'running') stats.running++;
    else if (res.status === 201 && body.status === 'queued') { stats.queued++; queuedIds.push(body.id); }
    else if (res.status === 503) stats.r503++;
    else if (res.status === 429) stats.r429++;
    else if (res.status === 400) stats.c400++;
    else { stats.other++; if (otherErrs.length < 5) otherErrs.push(`${res.status}:${JSON.stringify(body).slice(0, 100)}`); }
  } catch (e) {
    stats.total++; stats.other++;
    if (otherErrs.length < 5) otherErrs.push(`EXC:${String(e).slice(0, 100)}`);
  }
}

async function wave({ n, prefix }, concurrency = 20) {
  for (let batch = 0; batch < Math.ceil(n / concurrency); batch++) {
    const jobs = [];
    for (let i = 0; i < Math.min(concurrency, n - batch * concurrency); i++) {
      const idx = batch * concurrency + i + 1;
      jobs.push(post(`${prefix}.${idx}`));
    }
    await Promise.all(jobs);
  }
}

// ── 监控 ──
let monitoring = true;
const healthLat = [];
const memSamples = [];
async function monitor() {
  while (monitoring) {
    const t0 = Date.now();
    try {
      await fetch(`${BASE}/health`, { headers: { host: HOST }, signal: AbortSignal.timeout(5000) });
      healthLat.push(Date.now() - t0);
    } catch { healthLat.push(-1); }
    try {
      const out = execSync(`docker stats --no-stream --format '{{.MemUsage}}' ${CONTAINER}`, { encoding: 'utf8' }).trim();
      if (out) memSamples.push(out.split(' ')[0]);
    } catch { /* docker stats 偶发失败忽略 */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

function pct(arr, p) {
  const s = [...arr].filter((x) => x >= 0).sort((a, b) => a - b);
  if (!s.length) return 'n/a';
  return `${s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))]}ms`;
}

// ── 主流程 ──
const T0 = Date.now();
const mon = monitor();

for (const w of waves) {
  await wave(w);
  console.log(`[wave ${w.prefix}.x] 累计 ${stats.total} → running=${stats.running} queued=${stats.queued} 503=${stats.r503} 429=${stats.r429}`);
  await new Promise((r) => setTimeout(r, 500));
}

console.log(`\n[轮询风暴] 模拟 ${Math.min(60, queuedIds.length)} 个排队用户 1.5s/次 GET，持续 30s…`);
const pollLat = [];
const pollers = queuedIds.slice(0, 60).map((id) => {
  let stop = false;
  (async () => {
    while (!stop) {
      const t0 = Date.now();
      try { await fetch(`${BASE}/playground/sessions/${id}`, { headers: { host: HOST }, signal: AbortSignal.timeout(5000) }); pollLat.push(Date.now() - t0); } catch { pollLat.push(-1); }
      await new Promise((r) => setTimeout(r, 1500));
    }
  })();
  return () => { stop = true; };
});
await new Promise((r) => setTimeout(r, 30_000));
pollers.forEach((s) => s());

// 抽样验证排队位置
console.log(`\n[抽样] GET 前 5 个 queued 会话：`);
for (const id of queuedIds.slice(0, 5)) {
  try {
    const r = await fetch(`${BASE}/playground/sessions/${id}`, { headers: { host: HOST } });
    const b = await r.json();
    console.log(`  ${id.slice(0, 15)}… status=${b.status} queuePosition=${b.queuePosition ?? '-'} rounds=${b.events?.length ?? 0}`);
  } catch (e) { console.log(`  ${id} GET 失败 ${String(e).slice(0, 60)}`); }
}

monitoring = false;
await new Promise((r) => setTimeout(r, 100));

const dur = ((Date.now() - T0) / 1000).toFixed(1);
console.log(`
════════════ 压测报告（总耗时 ${dur}s）════════════
提交分布: total=${stats.total} running=${stats.running} queued=${stats.queued} 503=${stats.r503} 429=${stats.r429} 400=${stats.c400} other=${stats.other}
POST 延迟: p50=${pct(postLat, 50)} p95=${pct(postLat, 95)} max=${pct(postLat, 100)}
压测期 health 延迟 (${healthLat.length} 样本): p50=${pct(healthLat, 50)} max=${pct(healthLat, 100)} 失败=${healthLat.filter((x) => x < 0).length}
轮询 GET 延迟 (${pollLat.length} 样本): p50=${pct(pollLat, 50)} p95=${pct(pollLat, 95)} max=${pct(pollLat, 100)} 失败=${pollLat.filter((x) => x < 0).length}
api 内存: 首个=${memSamples[0] ?? 'n/a'} 峰值=${memSamples[memSamples.length - 1] ?? 'n/a'}（样本 ${memSamples.length} 个: ${memSamples.slice(-5).join(' → ')}）
${otherErrs.length ? `异常样本: ${otherErrs.join(' | ')}` : '无异常响应'}
`);
