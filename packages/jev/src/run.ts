import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DeepSeekClient } from '@a2t/adapters';
import { JevClient, JEV_DEFAULT_MODEL } from './client.js';
import { createDeterministicJudge } from './judges/deterministic.js';
import { createLlmJudge } from './judges/llm.js';
import { createJevJudge } from './judges/jev.js';
import { runHarness } from './harness.js';
import { buildReport, renderMarkdown, renderWebsiteJson } from './report.js';
import { buildSamples } from './samples/builder.js';
import type { Judge } from './judges/types.js';

const REPO = resolve(import.meta.dirname, '..', '..', '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const live = has('live');
  const limit = arg('limit') ? Number(arg('limit')) : undefined;

  const judges: Judge[] = [createDeterministicJudge()];
  if (live) {
    const dsKey = process.env.DEEPSEEK_API_KEY;
    const tsKey = process.env.TYPESAFE_API_KEY;
    if (!tsKey) throw new Error('缺少 TYPESAFE_API_KEY');
    const dsModel = process.env.JEV_LLM_MODEL ?? 'deepseek-chat';
    if (dsKey) judges.push(createLlmJudge(new DeepSeekClient({ apiKey: dsKey }), dsModel));
    judges.push(createJevJudge(new JevClient({ apiKey: tsKey })));
  } else {
    console.error('[jev] 未加 --live：仅跑确定性判官（不联网）。加 --live 跑三方对比。');
  }

  let samples = buildSamples();
  if (limit) samples = samples.slice(0, limit);

  const results = await runHarness(judges, samples);
  const report = buildReport(results, {
    generatedAt: new Date().toISOString(),
    jevModel: live ? JEV_DEFAULT_MODEL : 'n/a (no --live)',
    samples: samples.length,
  });

  const expDir = join(REPO, 'experiments', 'jev-judge-crosscheck');
  mkdirSync(expDir, { recursive: true });
  writeFileSync(join(expDir, 'report.md'), renderMarkdown(report));
  writeFileSync(join(expDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  const webPath = join(REPO, 'apps', 'dashboard', 'public', 'labs', 'jev-crosscheck.json');
  mkdirSync(dirname(webPath), { recursive: true });
  writeFileSync(webPath, renderWebsiteJson(report));

  for (const j of report.judges) {
    console.error(
      `[jev] ${j.judge}: acc=${(j.accuracy * 100).toFixed(1)}% n=${j.total} avgLatency=${j.avgLatencyMs}ms`,
    );
  }
  console.error('[jev] 写入 experiments/jev-judge-crosscheck/report.md 与 apps/dashboard/public/labs/jev-crosscheck.json');
}

main().catch((e: unknown) => {
  console.error('[jev] 执行失败:', (e as Error).message);
  process.exit(1);
});
