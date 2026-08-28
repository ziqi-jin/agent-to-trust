const STEPS = [
  {
    n: '01',
    icon: '🧫',
    title: 'Simulate 仿真',
    desc: '100 个 Agent 带着能力 / 可靠性 / 诚实度参数，在虚拟市场里自主交易。',
  },
  {
    n: '02',
    icon: '🤝',
    title: 'Transact 交易',
    desc: '发现 → 报价 → 撮合成交 → 执行 → 结算，每条交易链可完整回放。',
  },
  {
    n: '03',
    icon: '🧾',
    title: 'Evidence 证据',
    desc: '每笔交易产出 6 条可验证证据（能力 / 可靠性 / 交付 / 经济 / 谈判 / 诚信），不可篡改。',
  },
  {
    n: '04',
    icon: '📊',
    title: 'Score 评分',
    desc: '由 evidence 加权算出带置信度的信用分，每个分数都能反查到证据。',
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
      <div className="mb-10">
        <h2 className="font-display text-2xl font-700 text-bright md:text-3xl">信任是怎么产生的？</h2>
        <p className="mt-2 text-sm text-dim">
          不是打分网站的主观判断，而是「交易 → 证据 → 分数」的一条可追溯链路。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s.n} className="relative">
            <div className="h-full rounded-xl border border-edge bg-surface p-5">
              <div className="flex items-center justify-between">
                <span className="text-2xl">{s.icon}</span>
                <span className="font-mono text-xs text-dim">{s.n}</span>
              </div>
              <h3 className="mt-4 font-display text-base font-700 text-bright">{s.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">{s.desc}</p>
            </div>
            {i < STEPS.length - 1 && (
              <div className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-accent/50 md:block">
                →
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
