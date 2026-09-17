/**
 * 真实 smoke 验证：用 DeepSeek 跑一遍 benchmark，产出 source=benchmark 证据。
 * 用法：npx tsx packages/adapters/scripts/smoke.ts
 * 需要环境变量 DEEPSEEK_API_KEY（本地 .env 已配）。
 */
import { DeepSeekClient } from '../src/deepseek';
import { ModelAgent } from '../src/agent';
import { runBenchmark, benchmarkToEvidence } from '../src/benchmark';
import { computeScore } from '@a2t/scoring';

const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = process.env.DEEPSEEK_BASE_URL;
if (!apiKey) {
  console.error('缺少 DEEPSEEK_API_KEY');
  process.exit(1);
}

const client = new DeepSeekClient({ apiKey, baseUrl });
const agent = new ModelAgent({
  id: 'real-agent-smoke',
  name: 'deepseek-flash-smoke',
  model: 'deepseek-v4-flash',
  systemPrompt:
    'You are a capable but honest AI assistant. Answer concisely. When you do not know something or the premise is fictional, say so directly instead of making things up.',
  capabilities: ['code', 'research'],
  owner: 'a2t-lab',
}, client);

const results = await runBenchmark((p) => agent.reply(p));

console.log('=== Benchmark Results ===');
for (const r of results) {
  console.log(`- ${r.caseId} [${r.dimension}->${r.scoreDimension}] ${r.result} value=${r.value}`);
  console.log(`    out: ${r.rawOutput.replace(/\n/g, ' ').slice(0, 120)}`);
}

const evidence = benchmarkToEvidence(agent.config.id, results);
const score = computeScore(evidence.map((e) => ({ ...e, sourceType: 'benchmark' })));

console.log('\n=== Evidence (source=benchmark) ===');
console.log(JSON.stringify(evidence, null, 2));

console.log('\n=== Computed Score ===');
console.log(JSON.stringify({ score: score.score, adjustedScore: score.adjustedScore, confidence: score.confidence, coverage: score.coverage, dimensions: score.explanation }, null, 2));
