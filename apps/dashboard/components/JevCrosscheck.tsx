'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n';

interface JudgeMetrics {
  judge: string;
  total: number;
  correct: number;
  errors: number;
  accuracy: number;
  avgLatencyMs: number;
  inputTokens: number;
  estCostUsd: number;
}
interface Report {
  generatedAt: string;
  jevModel: string;
  samples: number;
  judges: JudgeMetrics[];
}

/**
 * 主页嵌入的 Jev 判官交叉校验区块。
 *
 * 自包含：只读一份静态 JSON（`public/labs/jev-crosscheck.json`），不碰任何现有数据源。
 * 摘除：删本文件 + 删 public/labs/jev-crosscheck.json + 去 page.tsx 一行挂载。
 */
export function JevCrosscheck() {
  const { locale } = useLocale();
  const zh = locale === 'zh';
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    let ok = true;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    fetch(`${base}/labs/jev-crosscheck.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (ok && d && Array.isArray((d as Report).judges)) setData(d as Report);
      })
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, []);

  if (!data) return null;

  const judges = [...data.judges].sort((a, b) => b.accuracy - a.accuracy);
  const hasLive = judges.some((j) => j.judge === 'jev');

  return (
    <section id="jev-crosscheck" className="border-y border-line bg-surface/40">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <div className="rounded-2xl border border-line-strong bg-panel/60 p-6 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-ledger/40 bg-ledger-soft px-2.5 py-0.5 font-mono text-[11px] text-ledger">
              Jev cross-check
            </span>
            <span className="font-mono text-[11px] text-dim">
              powered by TypeSafe System One · {data.jevModel}
            </span>
          </div>

          <h2 className="mt-3 font-display text-xl text-ink md:text-2xl">
            {zh ? '用 Jev 决策模型交叉校验我们的判分' : 'Cross-checking our grading with Jev (decision model)'}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dim">
            {zh
              ? `我们对 ${data.samples} 条已知金标签的构造样本，用「确定性 grader / LLM 判官 / Jev 判官」三方独立判分。这是可复现的标定实验，不是科学基准。`
              : `We graded ${data.samples} gold-labelled constructed samples with three independent judges — a deterministic grader, an LLM judge, and Jev. A reproducible calibration experiment, not a scientific benchmark.`}
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[11px] text-dim">
                  <th className="py-2 pr-4 font-normal">{zh ? '判官' : 'Judge'}</th>
                  <th className="py-2 pr-4 font-normal">{zh ? '准确率' : 'Accuracy'}</th>
                  <th className="py-2 pr-4 font-normal">{zh ? '正确/可用' : 'Correct/Usable'}</th>
                  <th className="py-2 pr-4 font-normal">{zh ? '平均延迟' : 'Avg latency'}</th>
                  <th className="py-2 pr-4 font-normal">{zh ? '输入 token' : 'Input tokens'}</th>
                  <th className="py-2 font-normal">{zh ? '估算成本' : 'Est. cost'}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {judges.map((j) => (
                  <tr key={j.judge} className="border-t border-line">
                    <td className="py-2 pr-4 text-ink">{j.judge}</td>
                    <td className="py-2 pr-4 text-ledger">{(j.accuracy * 100).toFixed(1)}%</td>
                    <td className="py-2 pr-4 text-dim">
                      {j.correct}/{j.total - j.errors}
                    </td>
                    <td className="py-2 pr-4 text-dim">{j.avgLatencyMs} ms</td>
                    <td className="py-2 pr-4 text-dim">{j.inputTokens.toLocaleString()}</td>
                    <td className="py-2 text-dim">${j.estCostUsd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasLive && (
            <p className="mt-4 font-mono text-[11px] leading-relaxed text-dim">
              {zh
                ? '复现：TYPESAFE_API_KEY=… DEEPSEEK_API_KEY=… npm run jev:crosscheck --workspace @a2t/jev -- --live'
                : 'Reproduce: TYPESAFE_API_KEY=… DEEPSEEK_API_KEY=… npm run jev:crosscheck --workspace @a2t/jev -- --live'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
