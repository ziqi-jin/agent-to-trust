/**
 * 演示：跑 100 个 Agent 自主交易，输出统计 + Top 分数。
 * 运行：npx tsx simulator/demo.ts
 */
import { runSimulation, scoreAgents } from './src/index';

const AGENT_COUNT = 100;
const ROUNDS = 100;
const INITIAL_WALLET = 1000;

const r = runSimulation({ agentCount: AGENT_COUNT, rounds: ROUNDS, seed: 42, initialWallet: INITIAL_WALLET });
const scores = scoreAgents(r);

const walletTotal = r.agents.reduce((s, a) => s + a.wallet, 0);

console.log(`=== Agent Credit Lab 仿真（${AGENT_COUNT} Agent × ${ROUNDS} 轮）===`);
console.log(`agents        : ${r.stats.agentCount}`);
console.log(`tasks         : ${r.stats.tasksCreated}`);
console.log(
  `transactions  : ${r.stats.transactions} (settled ${r.stats.settled} / partial ${r.stats.partial} / failed ${r.stats.failed})`,
);
console.log(`evidence      : ${r.evidence.length}`);
console.log(`成交总额      : ${r.stats.totalValue}`);
console.log(`钱包守恒      : ${walletTotal === AGENT_COUNT * INITIAL_WALLET ? '✓' : '✗'} (总余额 ${walletTotal})`);
console.log('');

const ranked = [...scores.entries()]
  .map(([id, s]) => ({ id, score: s.score, conf: s.confidence, ev: s.evidenceCount }))
  .filter((x) => x.score !== null)
  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

console.log('Top 5 agents by score:');
for (const a of ranked.slice(0, 5)) {
  console.log(`  ${a.id}  score=${a.score}  conf=${a.conf.toFixed(3)}  evidence=${a.ev}`);
}
console.log('');
console.log(`已评分 agent   : ${ranked.length} / ${r.agents.length}`);
