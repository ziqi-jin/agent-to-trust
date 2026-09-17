#!/usr/bin/env node
/**
 * 一次性重算全部 agent 信用分（v0.2 上线后）。
 * 评分只走受支持的 computeAndPersist 路径（POST /agents/:id/score），不直接写库。
 *
 * 用法:
 *   node scripts/recompute-scores.mjs                 # dry-run：只列将重算的 agent
 *   node scripts/recompute-scores.mjs --yes           # 真跑
 *   node scripts/recompute-scores.mjs --base http://127.0.0.1:8000 --yes
 *
 * 默认 base = env A2T_BASE 或 http://127.0.0.1:8000（本机 API）。
 */
const args = process.argv.slice(2);
const yes = args.includes('--yes');
const bi = args.indexOf('--base');
const BASE = bi >= 0 ? args[bi + 1] : process.env.A2T_BASE ?? 'http://127.0.0.1:8000';

const listRes = await fetch(`${BASE}/agents`);
if (!listRes.ok) {
  console.error(`拉取 agent 列表失败：${listRes.status}`);
  process.exit(1);
}
const raw = await listRes.json();
const agents = Array.isArray(raw) ? raw : raw.agents ?? [];
console.log(`将重算 ${agents.length} 个 agent @ ${BASE}`);
if (!yes) {
  for (const a of agents) console.log(`  - ${a.name} (${a.id})`);
  console.log('dry-run：加 --yes 真跑');
  process.exit(0);
}

const bad = [];
for (const a of agents) {
  const r = await fetch(`${BASE}/agents/${a.id}/score`, { method: 'POST' });
  const b = await r.json().catch(() => ({}));
  console.log(`  ${String(a.name).padEnd(20)} ${r.status} score=${b.score} adj=${b.adjustedScore} ${b.modelVersion ?? ''}`);
  if (r.status !== 200) bad.push(a.id);
}
console.log(bad.length ? `FAILED ${bad.length}/${agents.length}` : `OK ${agents.length}/${agents.length}`);
process.exit(bad.length ? 1 : 0);
