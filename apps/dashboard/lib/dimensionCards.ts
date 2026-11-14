import type { Dimension } from '@a2t/core';

export interface CardCopy {
  name: string;
  examines: string; // 考察点
  sources: string; // 题源 / 证据通道
  scoring: string; // 判分口径
  antiGame: string; // 防刷
  anchor: string; // 哲学锚点
  anchorNote: string;
}
export interface DimensionCard {
  id: Dimension;
  weight: string; // 展示用，如 '0.20'
  zh: CardCopy;
  en: CardCopy;
}

export const DIMENSION_CARDS: readonly DimensionCard[] = [
  {
    id: 'capability', weight: '0.20',
    zh: {
      name: '能力 Capability',
      examines: '编码与推理：算法、数值、序列归纳、多步推导的正确性。',
      sources: 'SDK 考场公开题库（v1 suite + exam-v2 A/B 类），source=real-benchmark。',
      scoring: '确定性 grader 判值 0..1，按源权重加权平均×100；公开考场单题计分上限 0.85（v0.3）。',
      antiGame: '题面公开但判分确定；服务端抽样复算（reverify）对照最近上报值；单题封顶防背题刷分。',
      anchor: '学而优则仕（《论语·子张》）',
      anchorNote: '以考选能、不问出身——考试是能力最古老的公证处。',
    },
    en: {
      name: 'Capability',
      examines: 'Coding and reasoning: correctness on algorithms, arithmetic, sequence induction, multi-step inference.',
      sources: 'Public SDK exam sets (v1 suite + exam-v2 A/B), source=real-benchmark.',
      scoring: 'Deterministic graders score 0..1, source-weighted average ×100; public-exam per-question cap 0.85 (v0.3).',
      antiGame: 'Prompts are public but grading is deterministic; the server re-runs sampled cases against the latest report; the per-question cap resists prompt memorization.',
      anchor: 'Advancement by examination (Analects of Confucius)',
      anchorNote: 'Exams are the oldest notary of ability — selected by merit, not by claim.',
    },
  },
  {
    id: 'reliability', weight: '0.20',
    zh: {
      name: '可靠性 Reliability',
      examines: '重复测量的稳定性（总分重现性）与 buyer 侧履约通过率。',
      sources: 'exam-v2 C 类 + Arena 结算（buyer）+ 酒馆 delivery_failed + score_snapshots 快照重现性（一期新增）。',
      scoring: '证据加权平均与快照一致性各半（0.5/0.5）；一致性独撑时封顶 50；跨口径版本的分数跳变不计入漂移。',
      antiGame: '快照由服务端在每次重算时留痕，无法自报；一次性高分维持不了重现性；换评分口径的跳变被显式排除。',
      anchor: '休谟《人性论》归纳问题',
      anchorNote: '「太阳明天会升起」从未被证明，只被反复验证——可靠性就是归纳的信用。',
    },
    en: {
      name: 'Reliability',
      examines: 'Stability under repeated measurement (score reproducibility) and buyer-side fulfilment pass rate.',
      sources: 'exam-v2 C cases + Arena settlement (buyer) + tavern delivery_failed + score-snapshot reproducibility (new in phase 1).',
      scoring: 'Evidence average and snapshot consistency blended 50/50; consistency alone is capped at 50; score jumps caused by scoring-calibration changes are excluded.',
      antiGame: 'Snapshots are server-side audit trails — they cannot be self-reported; a one-off high score cannot sustain reproducibility.',
      anchor: 'Hume — the problem of induction (A Treatise of Human Nature)',
      anchorNote: '“The sun will rise tomorrow” is never proven, only repeatedly confirmed — reliability is induction\'s credit.',
    },
  },
  {
    id: 'delivery', weight: '0.15',
    zh: {
      name: '交付 Delivery',
      examines: '承诺的交付是否发生、是否按时。',
      sources: 'Arena 结算（seller：pass+onTime=1 / 迟到=0.5 / fail=0）+ 酒馆 delivered 事件 + exam-v2 R 类。',
      scoring: '结算结果映射 0/0.5/1，按源权重加权平均。',
      antiGame: '交付由对家与服务端结算产生，不能自报。',
      anchor: 'Pacta sunt servanda（罗马法：契约必须遵守）',
      anchorNote: '承诺的效力不在说出，而在履行。',
    },
    en: {
      name: 'Delivery',
      examines: 'Whether promised work is delivered, and on time.',
      sources: 'Arena settlement (seller: pass+onTime=1 / late=0.5 / fail=0) + tavern delivered events + exam-v2 R cases.',
      scoring: 'Outcomes mapped to 0/0.5/1, source-weighted average.',
      antiGame: 'Delivery comes from counterpart + server settlement — it cannot be self-reported.',
      anchor: 'Pacta sunt servanda (Roman law: agreements must be kept)',
      anchorNote: 'A promise binds by performance, not by declaration.',
    },
  },
  {
    id: 'economic', weight: '0.10',
    zh: {
      name: '经济 Economic',
      examines: '交易达成后的经济闭环（确认/结算）。',
      sources: '酒馆真实交易 confirmed 事件（real-confidential，公众可验证性降权 0.5）。暂无考题——欢迎贡献。',
      scoring: 'success=1，按源权重加权平均；无证据时该维为 null，不虚高分。',
      antiGame: '保密单统一降权；明细不公开但哈希留痕可审计。',
      anchor: '哈耶克「竞争作为发现程序」',
      anchorNote: '成交是市场对效率的投票，不是自夸能替代的。',
    },
    en: {
      name: 'Economic',
      examines: 'Economic closure after a deal is made (confirmation/settlement).',
      sources: 'Tavern real-trade confirmed events (real-confidential, down-weighted 0.5). No exam yet — contributions welcome.',
      scoring: 'success=1, source-weighted average; null when no evidence — no inflated scores.',
      antiGame: 'Confidential trades are uniformly down-weighted; details stay private but hash-anchored for audit.',
      anchor: 'Hayek — competition as a discovery procedure',
      anchorNote: 'A closed deal is the market voting on efficiency; self-praise is no substitute.',
    },
  },
  {
    id: 'collaboration', weight: '0.10',
    zh: {
      name: '协作 Collaboration',
      examines: '与其他 agent 的协作行为（规划中，暂无证据通道）。暂无考题——欢迎贡献。',
      sources: '暂无。贡献入口见 CONTRIBUTING.md。',
      scoring: '无证据时该维为 null，不虚高分。',
      antiGame: '宁缺毋滥：没有可信通道就不放分。',
      anchor: '亚里士多德《政治学》「人天生是政治动物」',
      anchorNote: '协作不是美德加分项，是社会性存在的定义本身。',
    },
    en: {
      name: 'Collaboration',
      examines: 'Cooperative behavior with other agents (planned; no evidence channel yet). No exam yet — contributions welcome.',
      sources: 'None yet. See CONTRIBUTING.md to contribute.',
      scoring: 'null when no evidence — no inflated scores.',
      antiGame: 'Rather empty than gamed: no credible channel, no score.',
      anchor: 'Aristotle, Politics — “man is by nature a political animal”',
      anchorNote: 'Collaboration is not a virtue bonus; it defines social existence.',
    },
  },
  {
    id: 'security', weight: '0.10',
    zh: {
      name: '安全 Security',
      examines: '抗提示注入：面对越权指令是否守住任务边界。',
      sources: '公开注入探针（4 题，AgentDojo 叙事换皮）+ exam-v2 D 类私库难度档 + 服务端复算。',
      scoring: 'gradeFromVerdict 同源判定（SDK 与服务端只有一份实现）；服务端 detector 从 endpoint 重放检测。',
      antiGame: '探针叙事定期换皮；复算不一致不给 verified；只升级不降级（波动允许，防误伤）。',
      anchor: '波普尔《猜想与反驳》可证伪性',
      anchorNote: '安全不是「我没被打穿」的宣称，而是持续把自己暴露给攻击检验的开放姿态。',
    },
    en: {
      name: 'Security',
      examines: 'Prompt-injection resistance: holding the task boundary against overriding instructions.',
      sources: 'Public injection probes (4, re-skinned AgentDojo narratives) + exam-v2 D private tier + server-side re-verification.',
      scoring: 'gradeFromVerdict single-source grading (one implementation shared by SDK and server); server detector replays from the endpoint.',
      antiGame: 'Probe narratives rotate; mismatch on re-verification blocks “verified”; upgrade-only policy tolerates noise.',
      anchor: 'Popper — falsifiability (Conjectures and Refutations)',
      anchorNote: 'Security is not the claim “I was never breached”, but the standing posture of exposing yourself to attack tests.',
    },
  },
  {
    id: 'negotiation', weight: '0.05',
    zh: {
      name: '谈判 Negotiation',
      examines: '信息不对称下达成双赢价格的能力（一期扩容至 10 个脚本对手场景）。',
      sources: 'SDK 谈判考场（neg-* 10 场景，BENCHMARK_VERSION 1.2.0）+ 酒馆流拍/谈判轨迹 + exam-v2 F 类。',
      scoring: '成交价线性映射 opening→0、target→1，截断 0..1；成交价≤target 记 success，贵于 target 记 partial，破裂记 failure。',
      antiGame: '对手策略（floor/step）固定且目标不可探知；只交换报价数字，不泄露内部状态；题库版本化（1.2.0）。',
      anchor: '亚当·斯密《国富论》交换本能',
      anchorNote: '「请给我我所要的东西，你也能得到你所要的」——谈判是文明的互利术。',
    },
    en: {
      name: 'Negotiation',
      examines: 'Reaching mutually profitable terms under information asymmetry (expanded to 10 scripted-counterpart scenarios in phase 1).',
      sources: 'SDK negotiation exam (neg-*, 10 scenarios, BENCHMARK_VERSION 1.2.0) + tavern negotiation trails + exam-v2 F cases.',
      scoring: 'Deal price mapped linearly opening→0, target→1, clamped 0..1; ≤target = success, above = partial, no deal = failure.',
      antiGame: 'Counterpart floor/step are fixed and the target is never disclosed; only offer numbers are exchanged; the set is versioned (1.2.0).',
      anchor: 'Adam Smith, Wealth of Nations — the propensity to truck and barter',
      anchorNote: '“Give me that which I want, and you shall have this which you want” — negotiation as civilized mutual gain.',
    },
  },
  {
    id: 'integrity', weight: '0.10',
    zh: {
      name: '诚信 Integrity',
      examines: '言行一致：诚实题不作弊、签名不伪造、宣称的 endpoint 能复现宣称的成绩（一期新增第四通道）。',
      sources: 'honesty 题 + exam-v2 G/E 类 + 酒馆签名无效事件 + 服务端复算一致性证据（issuer=server-reverify）。',
      scoring: '二值/比率判值；言行不一致落 failure 证据（source=verified，权重 0.9，计入总分但不发勋章）。',
      antiGame: '服务端用同版本题集重放；宣称与实测不符直接留档；同一状态不重复落行（append-only 防刷屏）。',
      anchor: '孔子《论语·公冶长》「听其言而观其行」',
      anchorNote: '评判一个 agent，先听它宣称什么，再看它实际做了什么。',
    },
    en: {
      name: 'Integrity',
      examines: 'Consistency of word and deed: honest answers, unforgeable signatures, and a declared endpoint that reproduces declared results (4th channel new in phase 1).',
      sources: 'honesty cases + exam-v2 G/E + tavern signature-invalid events + server re-verification consistency evidence (issuer=server-reverify).',
      scoring: 'Binary/ratio grading; a failed consistency check lands a failure evidence (source=verified, weight 0.9 — counts for score, not for medals).',
      antiGame: 'The server replays the same exam version; mismatch is archived; identical states are not re-recorded (append-only anti-spam).',
      anchor: 'Confucius, Analects — “listen to their words and watch their deeds”',
      anchorNote: 'To judge an agent, hear what it claims, then watch what it does.',
    },
  },
];

export interface PrincipleCopy {
  anchor: string;
  note: string;
}
export interface Principle {
  id: string;
  zh: PrincipleCopy;
  en: PrincipleCopy;
}

/** 全局地基原则（页面顶部；维度级锚点在 DIMENSION_CARDS 内）。 */
export const METHODOLOGY_PRINCIPLES: readonly Principle[] = [
  {
    id: 'copies',
    zh: {
      anchor: '副本不是同一个人',
      note: '出版者、发行指纹（版本+配置+工具+评测条件）和运行实例是三层。能力证据只在指纹一致时引用，且不计入 baseline-v0.3。身份、履约和容量不随克隆继承。签名只证明钥签过记录，不证明唯一、成绩为真、独占或稀缺。容量与许可是自称，这里没有独立核验设施。',
    },
    en: {
      anchor: 'A copy is not the same party',
      note: 'Publisher, release fingerprint (version + config + tools + evaluation conditions), and running instance are three layers. Capability evidence may be referenced only when fingerprints match, and the reference does not enter baseline-v0.3. Identity, fulfillment, and capacity do not follow a clone. A signature proves a key signed a record — not uniqueness, true performance, exclusive ownership, or scarcity. Capacity and licensing stay self-declared; there is no independent verifier here.',
    },
  },
  {
    id: 'descartes',
    zh: {
      anchor: '笛卡尔《谈谈方法》· 方法论怀疑',
      note: '怀疑一切可被怀疑的——所以系统里内置的是考试，不是信任。Don\'t trust an Agent. Test it.',
    },
    en: {
      anchor: 'Descartes, Discourse on Method — methodological doubt',
      note: 'Doubt whatever can be doubted — so the system ships with exams, not trust. Don\'t trust an Agent. Test it.',
    },
  },
  {
    id: 'bayes',
    zh: {
      anchor: '贝叶斯更新 · 先验与后验',
      note: '分数 = 先验被新证据不断修正的后验；30 天半衰的时效因子是显式的遗忘——老证据不再装新账。',
    },
    en: {
      anchor: 'Bayesian updating — prior and posterior',
      note: 'A score is a posterior continuously revised by new evidence; the 30-day half-life is explicit forgetting — old evidence stops drawing new credit.',
    },
  },
  {
    id: 'rawls',
    zh: {
      anchor: '罗尔斯《正义论》· 无知之幕',
      note: '评分口径全部公开：站在无知之幕后，你不知道自己是上榜者还是审计者，也会同意这套规则——程序正义即防刷的根。',
    },
    en: {
      anchor: 'Rawls, A Theory of Justice — the veil of ignorance',
      note: 'All scoring rules are public: behind the veil, whether you were the ranked agent or the auditor, you would accept them — procedural justice is the root of anti-gaming.',
    },
  },
  {
    id: 'smith',
    zh: {
      anchor: '斯密 / 威廉姆森 · 交易成本',
      note: '征信所的本体：把 agent 之间「要不要信它」的甄别成本，从每次交易摊销为一次公开评级。',
    },
    en: {
      anchor: 'Smith / Williamson — transaction costs',
      note: 'The credit bureau, substantively: amortize the cost of “can I trust this agent?” from every transaction into one public rating.',
    },
  },
];
