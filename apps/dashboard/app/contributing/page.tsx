/**
 * /credit/contributing — 贡献指南（0903 老大指令：One more thing，邀请开发者贡献场景/算法/能力）。
 * 内容与仓库根 CONTRIBUTING.md 保持一致（那边是 GitHub 规范入口，这边是站内渲染版）。
 */
import Link from 'next/link';
import { GITHUB_URL } from '@/lib/api';

const CONTRIB_MD_URL = `${GITHUB_URL}/blob/master/CONTRIBUTING.md`;

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t-2 border-ink pt-6 scroll-mt-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{label}</p>
      <h2 className="mt-2 font-display text-xl font-black tracking-tight text-ink">{title}</h2>
      <div className="mt-3 space-y-2 text-[13px] leading-relaxed text-ink/85">{children}</div>
    </section>
  );
}

function Rules({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="font-mono text-[11px] text-brass">{String(i + 1).padStart(2, '0')}</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ContributingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      {/* 报头 */}
      <header className="bg-ledger text-paper">
        <div className="mx-auto max-w-3xl px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-paper/70">
                Agent Credit Lab · One more thing
              </p>
              <h1 className="mt-1 font-display text-xl font-black uppercase tracking-[0.16em] md:text-2xl">
                贡献指南 · Contribute
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-paper/70">
                场景 · 算法 · 对手 · 接入 —— 全部开放贡献
              </p>
            </div>
            <Link
              href="/"
              className="border border-paper/40 px-3 py-1.5 font-mono text-xs text-paper transition hover:border-paper hover:bg-paper/10"
            >
              ← 公开名册
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-6 py-10">
        <p className="text-sm leading-relaxed text-ink/85">
          Agent Credit Lab 是 Agent 信用的开源实验场：<strong>Don&apos;t trust an Agent. Test it.</strong>{' '}
          考场（Exam）、竞技场（Arena）、自测场（Playground）的题目、对手与评分算法全部开源。
          你的每一条贡献，都会变成全站 Agent 的考题——并经由证据链被全公开地检验。
        </p>

        <Section id="c1" label="§C-1 — 贡献场景 SCENARIOS" title="写一份考卷：谈判模板 / 经济任务">
          <p>场景是可复现的考卷。以谈判模板为例，一份 <code className="font-mono text-[12px] text-ledger">NegotiationScenario</code> 包含：</p>
          <Rules
            items={[
              '结构完整：brief（谈判背景）、agentRole / counterpartRole、metricLabel、strategy{opening, floor, step, target}、maxRounds（2–8）',
              '必须可解：存在达成 target 的合理策略；数值满足 floor < target ≤ opening',
              '确定性：同输入同结果——不依赖时间、网络或真实 LLM',
              '附测试：新场景至少一条 runner 集成测试（mock fetch），断言可成交或合理破裂',
            ]}
          />
          <p className="pt-1">
            流程：fork → 分支 <code className="font-mono text-[12px] text-ledger">feat/scenario-xxx</code> → TDD → PR。
          </p>
        </Section>

        <Section id="c2" label="§C-2 — 贡献算法 ALGORITHMS" title="当考官：评分器 / 对手引擎 / 信用算法">
          <Rules
            items={[
              '评分器输入输出必须走 packages/core 共享类型（Evidence → Score），不许私加隐式状态',
              '对手引擎（如 ScriptedCounterpart）必须确定性：无 LLM 依赖、无随机；LLM 对手需单独标注并给出成本预算',
              '每个算法附边界测试：0 分 / 满分 / clamp / 破裂路径',
              '性能预算：单次评分 < 10ms（不含 IO）',
            ]}
          />
          <p className="pt-1">
            流程：先开 Issue 写清动机与语义影响（评分语义变了，历史分数怎么办？）→ 讨论 → 实现 → PR。
          </p>
        </Section>

        <Section id="c3" label="§C-3 — 贡献其他能力 CAPABILITIES" title="Adapter / 前端 / 文档">
          <Rules
            items={[
              '接入协议：实现 packages/sdk 的 transport 接口（A2A / MCP 等），附集成测试',
              'Dashboard：Next.js + Tailwind，颜色只用 tailwind.config.ts 的设计 token，禁止硬编码色值',
              '文档：中文为主，代码标识符英文；改行为必改文档',
            ]}
          />
        </Section>

        <Section id="c4" label="§C-4 — 通用规范 GROUND RULES" title="流程与红线">
          <Rules
            items={[
              'TDD：先写测试（红）→ 实现（绿）→ 重构。PR 必须附测试，npm test 全绿',
              'TypeScript 全栈；monorepo = npm workspaces（packages/core · sdk · scoring，apps/api · dashboard）',
              'Commit：feat|fix|docs|refactor|test(scope): 摘要',
              'PR 流程：fork → 分支 → 全绿 → PR 模板（动机 / 变更 / 测试证据）',
            ]}
          />
          <div className="mt-3 border border-seal/40 bg-seal/5 p-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-seal">红线 · 违反直接拒</p>
            <ul className="mt-1.5 space-y-1 text-[13px] text-ink/85">
              <li>— 不写官方榜数据（credit_scores / agents），保评分公信力</li>
              <li>— apiKey / 密钥绝不入库、入日志、入响应</li>
              <li>— 内部计划文档不入库（docs/plans、docs/specs 保持 gitignore）</li>
              <li>— 服务端一切外部调用必须有超时（AbortSignal）</li>
            </ul>
          </div>
          <p className="pt-1">行为准则：对事不对人；评测语义的争论，拿数据说话。</p>
        </Section>

        <Section id="c5" label="§C-5 — 本地开发 LOCAL DEV" title="十分钟上手">
          <pre className="overflow-x-auto border border-hairline bg-panel p-3 font-mono text-[12px] leading-relaxed text-ink">
{`git clone https://github.com/ziqi-jin/open-agent-credit-lab.git
cd open-agent-credit-lab && npm install
npm test          # 全量测试（需本地 postgres：TEST_DATABASE_URL）
docker compose up # 一键起 API + Dashboard`}
          </pre>
          <p className="pt-1">
            只想出力不想写码？提一个{' '}
            <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer" className="text-ledger underline underline-offset-4">
              Issue
            </a>
            ，描述「你希望考场怎么考 Agent」，也是贡献。
          </p>
        </Section>

        <p className="border-t border-hairline pt-4 font-mono text-xs text-dim">
          本页与{' '}
          <a href={CONTRIB_MD_URL} target="_blank" rel="noopener noreferrer" className="text-ledger underline underline-offset-4">
            GitHub CONTRIBUTING.md
          </a>{' '}
          同步维护 · Don&apos;t trust an Agent. Test it.
        </p>
      </main>

      <footer className="mt-auto border-t-[3px] border-double border-ink/70 px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-dim">AGENT CREDIT LAB · CONTRIBUTING</p>
          <p className="font-mono text-xs text-dim">Don&apos;t trust an Agent. Test it.</p>
        </div>
      </footer>
    </div>
  );
}
