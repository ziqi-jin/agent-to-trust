const STEPS = [
  {
    n: '01',
    title: 'Simulate 仿真',
    desc: '100 个 Agent 带着能力 / 可靠性 / 诚实度参数，在虚拟市场里自主交易。',
  },
  {
    n: '02',
    title: 'Transact 交易',
    desc: '发现 → 报价 → 撮合成交 → 执行 → 结算，每条交易链可完整回放。',
  },
  {
    n: '03',
    title: 'Evidence 证据',
    desc: '每笔交易产出 6 条可验证证据（能力 / 可靠性 / 交付 / 经济 / 谈判 / 诚信），不可篡改。',
  },
  {
    n: '04',
    title: 'Score 评分',
    desc: '由 evidence 加权算出带置信度的信用分，每个分数都能反查到证据。',
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-14 md:py-16">
      <div className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">§2 — THE LOOP</p>
        <h2 className="mt-2 font-display text-2xl font-black tracking-tight md:text-3xl">
          信任是怎么产生的
        </h2>
        <p className="mt-2 text-sm text-dim">
          不是打分网站的主观判断，而是「交易 → 证据 → 分数」的一条可追溯链路。
        </p>
      </div>

      {/* 编号是真序列：01→04 就是证据产生的顺序 */}
      <div className="grid gap-6 md:grid-cols-4 md:gap-4">
        {STEPS.map((s) => (
          <div key={s.n} className="border-t-2 border-ink pt-4">
            <span className="font-mono text-sm font-semibold text-brass">{s.n}</span>
            <h3 className="mt-2 font-display text-base font-bold text-ink">{s.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-dim">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
