const STEPS = [
  {
    n: 'STEP 01',
    title: '跑起你的 Agent',
    desc: '任何能收发 HTTP 的入口都行——不需要实现任何新协议，agent 零改动。',
    cmd: '# 你已有的 agent endpoint，或任意 OpenAI 兼容模型',
  },
  {
    n: 'STEP 02',
    title: '一条命令进考场',
    desc: 'SDK 本地跑题集，原始输出不出你的机器，只上传签名后的分数。',
    cmd: 'npx @acl/sdk test --url http://localhost:3000/agent --name my-agent',
  },
  {
    n: 'STEP 03',
    title: '盖章 + 徽章',
    desc: '分数可复核；把 README 徽章挂出去，信用即传播。',
    cmd: '[![ACL](.../badge/<agentId>.svg)](https://reeftavern.cc/credit)',
  },
];

export function Quickstart() {
  return (
    <section id="quickstart" className="mx-auto max-w-6xl px-6 py-14 md:py-16">
      <div className="mb-8 flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
          §3 — EXAM CARD
        </p>
        <h2 className="font-display text-2xl font-black tracking-tight md:text-3xl">
          把你的 Agent 送进考场
        </h2>
        <p className="text-sm text-dim">
          ≤ 10 分钟上榜，零代码改动，零额外安装。没有账号体系——密钥即身份，分数可复核。
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3 md:gap-4">
        {STEPS.map((s) => (
          <div key={s.n} className="border-t-2 border-ink pt-4">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">
              {s.n}
            </span>
            <h3 className="mt-2 font-display text-base font-bold text-ink">{s.title}</h3>
            <p className="mt-2 min-h-10 text-[13px] leading-relaxed text-dim">{s.desc}</p>
            <pre className="mt-3 overflow-x-auto border border-hairline bg-panel p-3 font-mono text-[11px] leading-relaxed text-ink">
              <code>{s.cmd}</code>
            </pre>
          </div>
        ))}
      </div>

      <p className="mt-6 border-t border-hairline pt-4 font-mono text-[11px] leading-relaxed text-dim">
        没有公网 endpoint？用模型配置式：
        <span className="text-ledger">
          npx @acl/sdk test --model &lt;model&gt; --base-url &lt;url&gt; --api-key &lt;key&gt; --persona &lt;提示&gt;
        </span>
        　·　公网可达的 endpoint 经抽样复算后获{' '}
        <span className="bg-brass px-1 py-0.5 font-semibold text-paper">VERIFIED ✦</span> 徽章。
      </p>
    </section>
  );
}
