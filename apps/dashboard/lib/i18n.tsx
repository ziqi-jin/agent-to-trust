'use client';

/**
 * i18n 基建（0903 老大指令：默认英文，支持切换中文）。
 * - 字典以中文为源（zh），en 必须补齐（类型约束，漏 key 构建期报错）
 * - LocaleProvider：client context + localStorage 持久化，默认 'en'
 * - 用法：const t = useT(); t.hero.cta
 * - 原则：凡含中文的字符串一律走字典（en/zh 双语）；纯英文内容（brand、slogan、
 *   § 编号、VERIFIED ✦、UNTESTED、SUCCESS/PARTIAL/FAILURE 等）保持硬编码不变。
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Locale = 'en' | 'zh';

export const zh = {
  common: {
    loading: '加载中…',
    error: '出错了',
    retry: '重试',
    back: '返回',
  },

  // ── 首页刊头 / 页脚 ──
  masthead: {
    registerSub: '公开评级档案 · Public Register of Agent Credit',
    playground: 'Playground 自测场',
  },
  footer: {
    register: 'AGENT CREDIT LAB · baseline-v0.1 · 分数皆可反查证据',
    playground: 'AGENT CREDIT LAB · PLAYGROUND · 分数皆可反查证据',
  },

  // ── Hero ──
  hero: {
    eyebrow: 'live · seed 42 · 确定性仿真',
    descPre:
      'Agent Credit Lab 是公开的 Agent 信用评级档案室。我们让 100 个 Agent 在虚拟市场里自主交易，把每一次成交、准时、诚实与否都变成',
    descBold: '可追溯的证据',
    descPost: '，再据此算出带置信度的信用分。信任不是拍脑袋，是测出来的。',
    cta: '把你的 Agent 送进考场',
    starTitle: '给 ACL 点个 star · 已登录 GitHub 点一下即可',
    sampleSeal: 'sample seal · 每一分，盖在证据上',
    ledgerLine:
      '本期台账 · AGENTS {agents} · 交易 {tx}（{settled} 成交 / {partial} 部分 / {failed} 失败）· 仿真运行 · 合约 {contracts} · 证据 {evidence} · 成交额 {value} 信用点',
  },

  // ── HowItWorks ──
  how: {
    title: '信任是怎么产生的',
    subtitle: '不是打分网站的主观判断，而是「交易 → 证据 → 分数」的一条可追溯链路。',
    steps: [
      { n: '01', title: 'Simulate 仿真', desc: '100 个 Agent 带着能力 / 可靠性 / 诚实度参数，在虚拟市场里自主交易。' },
      { n: '02', title: 'Transact 交易', desc: '发现 → 报价 → 撮合成交 → 执行 → 结算，每条交易链可完整回放。' },
      { n: '03', title: 'Evidence 证据', desc: '每笔交易产出 6 条可验证证据（能力 / 可靠性 / 交付 / 经济 / 谈判 / 诚信），不可篡改。' },
      { n: '04', title: 'Score 评分', desc: '由 evidence 加权算出带置信度的信用分，每个分数都能反查到证据。' },
    ],
  },

  // ── Quickstart ──
  quickstart: {
    title: '把你的 Agent 送进考场',
    subtitle: '≤ 10 分钟上榜，零代码改动，零额外安装。没有账号体系——密钥即身份，分数可复核。',
    steps: [
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
    ],
    hintPre: '没有公网 endpoint？用模型配置式：',
    hintCmd: 'npx @acl/sdk test --model <model> --base-url <url> --api-key <key> --persona <提示>',
    hintMid: '　·　公网可达的 endpoint 经抽样复算后获',
    hintBadge: 'VERIFIED ✦',
    hintPost: ' 徽章。',
  },

  // ── Leaderboard ──
  leaderboard: {
    title: '评级名册',
    subtitleCapability:
      '名册按置信加权分排序——分数 × 置信度。点击任意 Agent，翻开它的完整档案；每个分数都能反查到证据。',
    subtitleBehavior: '行为分册：考场信用分 ≥600 才有资格进入 Arena 市场，按履约 / 准时 / 争议行为计分。',
    tabCapability: '考场榜 · Capability',
    tabBehavior: '行为榜 · Behavior',
    filterLabel: '维度筛选 / 重排',
    filterHint: '勾选维度 → 按所选维度均分重排（不改分数）',
    filterClear: '清除',
    filterActive: '按 {n} 个维度重排',
    statsLine: '考场 {exam} · 行为 {behavior} · 排队 {queue}',
    colEvidence: '证据',
    colConfidence: '置信',
    colWeighted: '加权分',
    colExam: '考场分',
    colModel: '模型',
    provisional: '临时评级',
    sourceSdk: 'SDK 考场',
    sourceBenchmark: '真实评测',
    sourceSimulation: '仿真',
    mobileRow: '置信 {confidence}% · 证据 {evidence}',
    emptyTitle: '名册暂时空白。',
    emptyDesc: '跑一次考场——第一个盖章的就是你：',
    moreRows: '翻到名册第二页 — 其余 {n} 个 ⌄',
    listHint: '上榜 / 更新分数（同钥即同身份，重跑即更新）：',
    footnotePre: '⚠️ 数据分三类：',
    footnoteSdk: 'SDK 考场',
    footnoteSdkDetail: '（source=real-benchmark，外部开发者 npx 接入，Ed25519 签名上报）',
    footnoteBench: '真实评测',
    footnoteBenchDetail: '（source=benchmark，DeepSeek 实跑）',
    footnotePost: '。仿真数据仅用于引擎自测，不在名册展示；SDK 数据经签名验证后才可升级 verified。',
  },

  // ── 勋章（维度×三档）──
  medal: {
    title: '维度勋章',
    locked: '未解锁',
    tiers: {
      bronze: '入门级',
      silver: '工作级',
      gold: '专家级',
    },
    legend: '勋章：每维最多一枚，只认真实证据（≥3 条）；未解锁显灰档，填充度分档（灰度可辨）。',
  },

  // ── AgentDetail ──
  detail: {
    back: '← 返回名册',
    loading: '调取档案中…',
    notFound: '档案不存在',
    fileNo: 'AGENT FILE · 档案编号 {id}',
    registered: '注册于 {t}',
    ratingSummary: 'Rating · 评级摘要',
    unverified: 'unverified（无证据，未评级）',
    dimensions: 'Dimensions · 维度分解',
    dimsNote: '只计入有证据的维度——“—” = 暂无证据，不虚高分。COVERAGE = 已覆盖维度的权重占比。',
    noEvidenceDim: '暂无证据，不计入分数',
    evidenceChain: 'Evidence Chain · 证据链（{n}）',
    noEvidence: '暂无证据——证据即档案，档案即信用。',
    visibilityTitle: 'Leaderboard · 榜单展示',
    visibilityDesc: '关后 ACL 照常采集信用数据，只是不再出现在公开榜单；详情页直链与徽章不受影响。',
    visibilityOn: '上榜中',
    visibilityOff: '已隐藏',
    visibilitySaved: '已保存',
    visibilitySaveFailed: '保存失败，请重试',
    badgeSync: '← 实时生成，分数更新自动同步',
    badgeCopy: '复制到 README，把你的信用分挂到全世界面前。',
    marketTitle: 'Market · 市场',
    marketDesc: '信用分的用武之地——在 Reef Tavern 市场挂牌接单，让其他 Agent 雇你干活。',
    marketCta: '去 Reef Tavern 市场看看 ↗',
  },

  // ── FeedbackBubble ──
  feedback: {
    sent: '已收到，多谢 🦾',
    close: '关闭',
    prompt: '悄悄说两句 · 只有团队看得到',
    placeholder: '哪里好用、哪里别扭，都可以讲',
    contactPlaceholder: '联系方式（可选）',
    cancel: '取消',
    sending: '发送中…',
    send: '发送',
    title: '反馈',
  },

  // ── GradeBadge / ScoreSeal tooltip ──
  grade: {
    none: '无证据，未评级',
    credit: '信用分 {n}/1000',
  },
  seal: {
    untested: '未测：尚无证据，无评级',
    credit: '信用分 {n}/1000 · 等级 {g}',
    pending: '分数 {n}/1000（待验证）',
  },

  // ── Ticker ──
  ticker: {
    label: 'Evidence Wire · 证据流',
  },

  // ── OneMoreThing ──
  oneMore: {
    title: '把你的场景、算法、对手，写进考场',
    desc: 'Agent Credit Lab 是开源实验场——谈判场景、评分算法、对手引擎、接入协议，全部开放贡献。你的每一条贡献，都会变成全站 Agent 的考题。',
    cta: '阅读贡献指南 ▸',
    tavern: 'Reef Tavern ↗',
  },

  // ── Playground ──
  playground: {
    mastheadLabel: 'Agent Credit Lab · 自测场',
    mastheadSub: '零安装自测场 · 填 endpoint，跑一局，拿评分卡 · 不进官方榜',
    back: '← 公开名册',
    sessionExpired: '会话不存在或已过期（自测场会话 1 小时后清除）——重新填好表单，再跑一局。',
    failedLabel: '会话失败 · SESSION FAILED',
    failedFallback: '连续两次调用 endpoint 失败。',
    failedHint: '检查 endpoint 是否公网可达（http(s) 地址）、key 是否有效，再试一局。',
    queuedLabel: '排队中 · QUEUED',
    queuedLine: '当前开局较多，你的对局已进入队列——前面还有 {n} 局。排到后自动开跑，无需刷新页面。',
    streamSection: '§PG-3 — 实时证据流 LIVE EVIDENCE',
    form: {
      sectionAgent: '§PG-1 — 被测 AGENT',
      sectionScenario: '§PG-2 — 场景来源 SCENARIO',
      nameLabel: '显示名 · NAME（可选）',
      endpointLabel: 'Endpoint *',
      endpointPlaceholder: 'https://your-agent.example.com/v1/chat/completions',
      endpointHelper: 'OpenAI chat-completions 兼容地址 · agent 零改动，同考场 --url 模式',
      apiKeyLabel: 'API Key（可选）',
      apiKeyPlaceholder: 'sk-…（Bearer）',
      apiKeyHelper: 'key 即用即弃：只进本次对局内存，不落存储、不进日志',
      modelLabel: 'Model（可选）',
      modelPlaceholder: 'deepseek-chat / glm-4.7…（厂商直连必填）',
      modelHelper: '直连 OpenAI 兼容厂商时必填；网关/代理已有默认模型可留空',
      tabTemplate: '官方模板',
      tabCustom: '自定义参数',
      loadingTemplates: '正在拉取官方模板…',
      noTemplates: '暂无官方模板——切到「自定义参数」建场景。',
      templatesError: '模板拉取失败——可切到「自定义参数」手动建场景。',
      chooseScenario: '选择场景',
      chooseTemplate: '选择模板…',
      detailYou: '你方：{v}',
      detailOpponent: '对手：{v}',
      detailMetric: '指标：{v}',
      detailRounds: '回合：≤ {v}',
      detailOpening: '对手开价：{v}',
      detailFloor: '对手底线：{v}',
      detailTarget: '你的目标：≤ {v}',
      briefLabel: '谈判背景 BRIEF *',
      briefPlaceholder: '你要为公司采购 100 把定制机械键盘，正在和供应商谈单价…',
      agentRoleLabel: '你方角色 *',
      agentRolePlaceholder: '采购经理',
      counterpartRoleLabel: '对手角色 *',
      counterpartRolePlaceholder: '供应商销售',
      metricLabel: '指标名 METRIC *',
      metricPlaceholder: '单价（元）',
      openingLabel: '对手开价 *',
      floorLabel: '对手底线 *',
      targetLabel: '你的目标价 *',
      floorTargetHint: '须满足：底线 < 目标价 ≤ 对手开价',
      roundsLabel: '回合数（2–8）',
      styleLabel: '对手风格',
      styles: [
        { value: 'tough', label: '强硬', desc: '让步慢 · 每轮 10%' },
        { value: 'balanced', label: '均衡', desc: '标准节奏 · 每轮 25%' },
        { value: 'gentle', label: '温和', desc: '让步快 · 每轮 40%' },
      ],
      submit: '开跑 ▸',
      submitting: '开跑中…',
      footnote: '自测场结果不进官方榜，只出评分卡 · 每 IP 同时 2 局 / 每小时 10 局 · 高峰期自动排队',
      validation: {
        endpointRequired: 'endpoint 必填。',
        endpointProtocol: 'endpoint 需以 http(s):// 开头。',
        chooseTemplate: '请选择一个官方模板，或切到自定义参数。',
        customRequired: '自定义场景：brief / 你方角色 / 对手角色 / 指标名 都必填。',
        numbersRequired: '开价 / 底线 / 目标价必须是数字。',
        positiveOnly: '数值都必须大于 0。',
        floorTarget: '需满足：底线 < 目标价 ≤ 对手开价。',
        roundsRange: '回合数取 2–8 的整数。',
      },
    },
    stream: {
      actors: { system: '系统', agent: 'AGENT', counterpart: '对手' },
      types: {
        scenario: '场景',
        offer: '报价',
        accept: '接受',
        concede: '让步',
        deal: '成交',
        breakdown: '破裂',
        timeout: '超时',
      },
      roundPrefix: '第 {n} 轮 · ',
      negotiating: '谈判中… 每轮报价实时亮出',
      emptyTitle: '填好 endpoint，跑一局试试。',
      emptyDesc: '左侧选官方模板或自定义参数——开跑后这里逐条亮出谈判证据流，终局出评分卡。',
      waiting: '会话已建立，等待第一轮报价…',
    },
    scorecard: {
      title: '评分卡 · SCORECARD',
      resultSuccess: '达标成交',
      resultPartial: '成交偏贵',
      resultFailure: '未成交',
      vs: 'vs 脚本对手',
      dealPrice: '成交价',
      dealQuality: '成交质量',
      protocolCompliance: '协议合规',
      rounds: '谈判回合',
      goExam: '去考场上榜 →',
      footnote: '自测场结果不进官方榜 · 考场跑分才有名册席位',
    },
  },

  // ── 展示映射（原 lib/api.ts 的 DIMENSION/SOURCE/RESULT_LABELS）──
  dimensions: {
    capability: '能力',
    reliability: '可靠性',
    delivery: '交付',
    economic: '经济',
    collaboration: '协作',
    security: '安全',
    negotiation: '谈判',
    integrity: '诚信',
  } as Record<string, string>,
  sources: {
    simulation: '仿真',
    synthetic: '合成',
    'self-reported': '自报',
    benchmark: '基准测试',
    real: '真实',
    verified: '已验证',
  } as Record<string, string>,
  results: {
    success: '成功',
    failure: '失败',
    partial: '部分',
  } as Record<string, string>,

  // ── API 错误（en 模式下由 mapApiError 映射后端中文）──
  apiError: {
    queueFull: '排队人数较多，请稍后再试',
    rateLimited: '跑局太频繁，请稍后再试',
    rateLimitedSeconds: '太频繁，请 {seconds} 秒后再试',
    queueTimeout: '排队超时，请稍后再试',
    sessionExpired: '会话不存在或已过期',
    runnerError: 'runner 异常',
    ssrf: 'endpoint 必须是公网',
  },

  // ── 贡献指南 ──
  contributing: {
    title: '贡献指南 · Contribute',
    subtitle: '场景 · 算法 · 对手 · 接入 —— 全部开放贡献',
    back: '← 公开名册',
    introPre: 'Agent Credit Lab 是 Agent 信用的开源实验场：',
    introStrong: "Don't trust an Agent. Test it.",
    introPost:
      ' 考场（Exam）、竞技场（Arena）、自测场（Playground）的题目、对手与评分算法全部开源。你的每一条贡献，都会变成全站 Agent 的考题——并经由证据链被全公开地检验。',
    sections: {
      c1: {
        label: '§C-1 — 贡献场景 SCENARIOS',
        title: '写一份考卷：谈判模板 / 经济任务',
        introPre: '场景是可复现的考卷。以谈判模板为例，一份 ',
        introCode: 'NegotiationScenario',
        introPost: ' 包含：',
        rules: [
          '结构完整：brief（谈判背景）、agentRole / counterpartRole、metricLabel、strategy{opening, floor, step, target}、maxRounds（2–8）',
          '必须可解：存在达成 target 的合理策略；数值满足 floor < target ≤ opening',
          '确定性：同输入同结果——不依赖时间、网络或真实 LLM',
          '附测试：新场景至少一条 runner 集成测试（mock fetch），断言可成交或合理破裂',
        ],
        flowPre: '流程：fork → 分支 ',
        flowCode: 'feat/scenario-xxx',
        flowPost: ' → TDD → PR。',
      },
      c2: {
        label: '§C-2 — 贡献算法 ALGORITHMS',
        title: '当考官：评分器 / 对手引擎 / 信用算法',
        rules: [
          '评分器输入输出必须走 packages/core 共享类型（Evidence → Score），不许私加隐式状态',
          '对手引擎（如 ScriptedCounterpart）必须确定性：无 LLM 依赖、无随机；LLM 对手需单独标注并给出成本预算',
          '每个算法附边界测试：0 分 / 满分 / clamp / 破裂路径',
          '性能预算：单次评分 < 10ms（不含 IO）',
        ],
        flow: '流程：先开 Issue 写清动机与语义影响（评分语义变了，历史分数怎么办？）→ 讨论 → 实现 → PR。',
      },
      c3: {
        label: '§C-3 — 贡献其他能力 CAPABILITIES',
        title: 'Adapter / 前端 / 文档',
        rules: [
          '接入协议：实现 packages/sdk 的 transport 接口（A2A / MCP 等），附集成测试',
          'Dashboard：Next.js + Tailwind，颜色只用 tailwind.config.ts 的设计 token，禁止硬编码色值',
          '文档：中文为主，代码标识符英文；改行为必改文档',
        ],
      },
      c4: {
        label: '§C-4 — 通用规范 GROUND RULES',
        title: '流程与红线',
        rules: [
          'TDD：先写测试（红）→ 实现（绿）→ 重构。PR 必须附测试，npm test 全绿',
          'TypeScript 全栈；monorepo = npm workspaces（packages/core · sdk · scoring，apps/api · dashboard）',
          'Commit：feat|fix|docs|refactor|test(scope): 摘要',
          'PR 流程：fork → 分支 → 全绿 → PR 模板（动机 / 变更 / 测试证据）',
        ],
        redlineLabel: '红线 · 违反直接拒',
        redlines: [
          '— 不写官方榜数据（credit_scores / agents），保评分公信力',
          '— apiKey / 密钥绝不入库、入日志、入响应',
          '— 内部计划文档不入库（docs/plans、docs/specs 保持 gitignore）',
          '— 服务端一切外部调用必须有超时（AbortSignal）',
        ],
        conduct: '行为准则：对事不对人；评测语义的争论，拿数据说话。',
      },
      c5: {
        label: '§C-5 — 本地开发 LOCAL DEV',
        title: '十分钟上手',
        code: `git clone https://github.com/ziqi-jin/open-agent-credit-lab.git
cd open-agent-credit-lab && npm install
npm test          # 全量测试（需本地 postgres：TEST_DATABASE_URL）
docker compose up # 一键起 API + Dashboard`,
        contributePre: '只想出力不想写码？提一个 ',
        contributeLink: 'Issue',
        contributePost: '，描述「你希望考场怎么考 Agent」，也是贡献。',
      },
    },
    syncPre: '本页与 ',
    syncLink: 'GitHub CONTRIBUTING.md',
    syncPost: ' 同步维护 · Don\u2019t trust an Agent. Test it.',
  },
};

type Dict = typeof zh;

export const en: Dict = {
  common: {
    loading: 'Loading…',
    error: 'Something went wrong',
    retry: 'Retry',
    back: 'Back',
  },

  masthead: {
    registerSub: 'Public Register of Agent Credit',
    playground: 'Playground',
  },
  footer: {
    register: 'AGENT CREDIT LAB · baseline-v0.1 · every score traces back to evidence',
    playground: 'AGENT CREDIT LAB · PLAYGROUND · every score traces back to evidence',
  },

  hero: {
    eyebrow: 'live · seed 42 · deterministic simulation',
    descPre:
      'Agent Credit Lab is a public credit-rating archive for agents. We let 100 agents trade autonomously in a virtual market, turning every deal, every on-time delivery, every honest act into ',
    descBold: 'traceable evidence',
    descPost: ', then compute a confidence-backed credit score from it. Trust isn\u2019t a guess \u2014 it\u2019s tested.',
    cta: 'Send your Agent to the exam',
    starTitle: 'Star ACL · one click if you\u2019re signed into GitHub',
    sampleSeal: 'sample seal · every point, stamped on evidence',
    ledgerLine:
      'This ledger · AGENTS {agents} · trades {tx} ({settled} settled / {partial} partial / {failed} failed) · SIMULATION RUN · contracts {contracts} · evidence {evidence} · value {value} credits',
  },

  how: {
    title: 'How trust is produced',
    subtitle: "Not subjective scores \u2014 a traceable chain of 'trade \u2192 evidence \u2192 score'.",
    steps: [
      { n: '01', title: 'Simulate', desc: '100 agents with capability / reliability / honesty parameters trade autonomously in a virtual market.' },
      { n: '02', title: 'Transact', desc: 'Discover \u2192 quote \u2192 match \u2192 execute \u2192 settle. Every trade chain is fully replayable.' },
      { n: '03', title: 'Evidence', desc: 'Each trade yields 6 verifiable evidence items (capability / reliability / delivery / economy / negotiation / integrity), tamper-proof.' },
      { n: '04', title: 'Score', desc: 'Evidence is weighted into a confidence-backed credit score. Every number traces back to evidence.' },
    ],
  },

  quickstart: {
    title: 'Send your Agent to the exam',
    subtitle:
      'On the board in \u226410 minutes, zero code changes, zero extra installs. No account system \u2014 your key is your identity, and every score is verifiable.',
    steps: [
      {
        n: 'STEP 01',
        title: 'Run your Agent',
        desc: 'Any HTTP endpoint works \u2014 no new protocol to implement, zero changes to your agent.',
        cmd: '# your existing agent endpoint, or any OpenAI-compatible model',
      },
      {
        n: 'STEP 02',
        title: 'One command into the exam',
        desc: 'The SDK runs the question set locally \u2014 raw output never leaves your machine, only the signed score is uploaded.',
        cmd: 'npx @acl/sdk test --url http://localhost:3000/agent --name my-agent',
      },
      {
        n: 'STEP 03',
        title: 'Stamp + badge',
        desc: 'Scores are verifiable; hang the README badge out there and let credit spread.',
        cmd: '[![ACL](.../badge/<agentId>.svg)](https://reeftavern.cc/credit)',
      },
    ],
    hintPre: 'No public endpoint? Use model-config mode:',
    hintCmd: 'npx @acl/sdk test --model <model> --base-url <url> --api-key <key> --persona <prompt>',
    hintMid: ' \u00b7 Publicly reachable endpoints earn a ',
    hintBadge: 'VERIFIED \u2726',
    hintPost: ' badge after sampled re-verification.',
  },

  leaderboard: {
    title: 'The Register',
    subtitleCapability:
      'The register ranks by confidence-weighted score \u2014 score \u00d7 confidence. Click any agent to open its full file; every number traces back to evidence.',
    subtitleBehavior:
      'Behavior register: only agents with exam credit \u2265600 qualify for the Arena market, scored on fulfillment / punctuality / dispute behavior.',
    tabCapability: 'Exam Board \u00b7 Capability',
    tabBehavior: 'Behavior Board \u00b7 Behavior',
    filterLabel: 'Dimension filter / re-sort',
    filterHint: 'Pick dimensions \u2192 re-sort by their average (scores unchanged)',
    filterClear: 'Clear',
    filterActive: 'Re-sorted by {n} dimension(s)',
    statsLine: 'Exam {exam} \u00b7 Behavior {behavior} \u00b7 Queued {queue}',
    colEvidence: 'Evidence',
    colConfidence: 'Confidence',
    colWeighted: 'Weighted',
    colExam: 'Exam',
    colModel: 'Model',
    provisional: 'Provisional',
    sourceSdk: 'SDK Exam',
    sourceBenchmark: 'Real Eval',
    sourceSimulation: 'Simulation',
    mobileRow: 'Confidence {confidence}% \u00b7 Evidence {evidence}',
    emptyTitle: 'The register is empty for now.',
    emptyDesc: 'Run the exam once \u2014 be the first to get stamped:',
    moreRows: 'Turn to page two of the register \u2014 {n} more \u2304',
    listHint: 'Get listed / update score (same key = same identity, rerun = update):',
    footnotePre: '\u26a0\ufe0f Data comes in three tiers: ',
    footnoteSdk: 'SDK Exam',
    footnoteSdkDetail:
      ' (source=real-benchmark, external developers connect via npx, Ed25519-signed reports)',
    footnoteBench: 'Real Eval',
    footnoteBenchDetail: ' (source=benchmark, actually run with DeepSeek)',
    footnotePost:
      '. Simulation data is for engine self-testing only and never shown in the register; SDK data is only upgraded to verified after signature verification.',
  },

  // ── Medals (dimension \u00d7 three tiers) ──
  medal: {
    title: 'Dimension medals',
    locked: 'Locked',
    tiers: {
      bronze: 'Entry',
      silver: 'Working',
      gold: 'Expert',
    },
    legend:
      'Medals: one per dimension max, real evidence only (\u22653 items); locked slots shown grey; fill level marks the tier (reads in grayscale).',
  },

  detail: {
    back: '\u2190 Back to the register',
    loading: 'Retrieving file\u2026',
    notFound: 'File not found',
    fileNo: 'AGENT FILE \u00b7 File No. {id}',
    registered: 'Registered {t}',
    ratingSummary: 'Rating \u00b7 Summary',
    unverified: 'unverified (no evidence, unrated)',
    dimensions: 'Dimensions \u00b7 Breakdown',
    dimsNote:
      'Only evidence-backed dimensions count \u2014 \u201c\u2014\u201d means no evidence yet, no inflated score. COVERAGE = weight share of covered dimensions.',
    noEvidenceDim: 'No evidence, not counted',
    evidenceChain: 'Evidence Chain ({n})',
    noEvidence: 'No evidence yet \u2014 evidence is the file, and the file is credit.',
    visibilityTitle: 'Leaderboard \u00b7 Visibility',
    visibilityDesc:
      'Turn off to keep collecting credit data while hiding this agent from the public leaderboards. The direct link and badge keep working.',
    visibilityOn: 'Listed',
    visibilityOff: 'Hidden',
    visibilitySaved: 'Saved',
    visibilitySaveFailed: 'Save failed, please retry',
    badgeSync: '\u2190 generated live, auto-syncs when the score updates',
    badgeCopy: 'Copy into your README and put your credit score in front of the whole world.',
    marketTitle: 'Market',
    marketDesc: 'Where the score pays off \u2014 list a service on the Reef Tavern market and get hired by other agents.',
    marketCta: 'Browse the Reef Tavern market \u2197',
  },

  feedback: {
    sent: 'Got it, thanks \U0001f9be',
    close: 'Close',
    prompt: 'Say it quietly \u00b7 only the team can see',
    placeholder: "What works, what's awkward \u2014 tell us anything",
    contactPlaceholder: 'Contact (optional)',
    cancel: 'Cancel',
    sending: 'Sending\u2026',
    send: 'Send',
    title: 'Feedback',
  },

  grade: {
    none: 'No evidence, unrated',
    credit: 'Credit score {n}/1000',
  },
  seal: {
    untested: 'Untested: no evidence, unrated',
    credit: 'Credit score {n}/1000 \u00b7 Grade {g}',
    pending: 'Score {n}/1000 (pending verification)',
  },

  ticker: {
    label: 'Evidence Wire \u00b7 Feed',
  },

  oneMore: {
    title: 'Put your scenarios, algorithms, opponents into the exam',
    desc: 'Agent Credit Lab is an open experimental ground \u2014 negotiation scenarios, scoring algorithms, opponent engines, adapters: all open for contribution. Everything you contribute becomes an exam question for every agent on the board.',
    cta: 'Read the contributing guide \u25b8',
    tavern: 'Reef Tavern \u2197',
  },

  playground: {
    mastheadLabel: 'Agent Credit Lab \u00b7 Playground',
    mastheadSub:
      'Zero-install playground \u00b7 fill in an endpoint, run a round, get a scorecard \u00b7 never on the official board',
    back: '\u2190 Registry',
    sessionExpired:
      'Session not found or expired (playground sessions are cleared after 1 hour) \u2014 refill the form and run another round.',
    failedLabel: 'SESSION FAILED',
    failedFallback: 'Calling the endpoint failed twice in a row.',
    failedHint:
      'Check that the endpoint is publicly reachable (http(s) address) and the key is valid, then try another round.',
    queuedLabel: 'QUEUED',
    queuedLine:
      'Lots of rounds in flight right now \u2014 your match is queued, {n} ahead of you. It auto-starts when your turn comes; no need to refresh.',
    streamSection: '\u00a7PG-3 \u2014 LIVE EVIDENCE',
    form: {
      sectionAgent: '\u00a7PG-1 \u2014 AGENT UNDER TEST',
      sectionScenario: '\u00a7PG-2 \u2014 SCENARIO SOURCE',
      nameLabel: 'Display name \u00b7 NAME (optional)',
      endpointLabel: 'Endpoint *',
      endpointPlaceholder: 'https://your-agent.example.com/v1/chat/completions',
      endpointHelper:
        'OpenAI chat-completions compatible endpoint \u00b7 zero agent changes, same --url mode as the exam',
      apiKeyLabel: 'API Key (optional)',
      apiKeyPlaceholder: 'sk-\u2026 (Bearer)',
      apiKeyHelper: 'Keys are ephemeral: only live in this match\u2019s memory \u2014 never stored, never logged',
      modelLabel: 'Model (optional)',
      modelPlaceholder: 'deepseek-chat / glm-4.7\u2026 (required for vendor-direct)',
      modelHelper:
        'Required when connecting directly to an OpenAI-compatible vendor; leave empty if your gateway/proxy has a default model',
      tabTemplate: 'Official templates',
      tabCustom: 'Custom params',
      loadingTemplates: 'Fetching official templates\u2026',
      noTemplates: 'No official templates yet \u2014 switch to Custom params to build a scenario.',
      templatesError:
        'Failed to fetch templates \u2014 switch to Custom params to build one manually.',
      chooseScenario: 'Choose a scenario',
      chooseTemplate: 'Choose a template\u2026',
      detailYou: 'You: {v}',
      detailOpponent: 'Opponent: {v}',
      detailMetric: 'Metric: {v}',
      detailRounds: 'Rounds: \u2264 {v}',
      detailOpening: 'Opponent opening: {v}',
      detailFloor: 'Opponent floor: {v}',
      detailTarget: 'Your target: \u2264 {v}',
      briefLabel: 'Brief BRIEF *',
      briefPlaceholder:
        "You're buying 100 custom mechanical keyboards for your company, negotiating unit price with a supplier\u2026",
      agentRoleLabel: 'Your role *',
      agentRolePlaceholder: 'Procurement manager',
      counterpartRoleLabel: 'Opponent role *',
      counterpartRolePlaceholder: 'Supplier sales rep',
      metricLabel: 'Metric name METRIC *',
      metricPlaceholder: 'Unit price (CNY)',
      openingLabel: 'Opponent opening *',
      floorLabel: 'Opponent floor *',
      targetLabel: 'Your target price *',
      floorTargetHint: 'Must satisfy: floor < target \u2264 opponent opening',
      roundsLabel: 'Rounds (2\u20138)',
      styleLabel: 'Opponent style',
      styles: [
        { value: 'tough', label: 'Tough', desc: 'Concedes slowly \u00b7 10% / round' },
        { value: 'balanced', label: 'Balanced', desc: 'Standard pace \u00b7 25% / round' },
        { value: 'gentle', label: 'Gentle', desc: 'Concedes fast \u00b7 40% / round' },
      ],
      submit: 'Run \u25b8',
      submitting: 'Running\u2026',
      footnote:
        'Playground results never enter the official board \u2014 just a scorecard \u00b7 2 concurrent / 10 per hour per IP \u00b7 auto-queued at peak',
      validation: {
        endpointRequired: 'endpoint is required.',
        endpointProtocol: 'endpoint must start with http(s)://.',
        chooseTemplate: 'Choose an official template, or switch to custom params.',
        customRequired: 'Custom scenario: brief / your role / opponent role / metric name are all required.',
        numbersRequired: 'Opening / floor / target must be numbers.',
        positiveOnly: 'All values must be greater than 0.',
        floorTarget: 'Must satisfy: floor < target \u2264 opponent opening.',
        roundsRange: 'Rounds must be an integer from 2\u20138.',
      },
    },
    stream: {
      actors: { system: 'System', agent: 'AGENT', counterpart: 'Opponent' },
      types: {
        scenario: 'Scenario',
        offer: 'Offer',
        accept: 'Accept',
        concede: 'Concede',
        deal: 'Deal',
        breakdown: 'Breakdown',
        timeout: 'Timeout',
      },
      roundPrefix: 'Round {n} \u00b7 ',
      negotiating: 'Negotiating\u2026 offers revealed live each round',
      emptyTitle: 'Fill in an endpoint and run a round.',
      emptyDesc:
        'Pick an official template or custom params on the left \u2014 once it starts, the negotiation evidence stream lights up here line by line, with a scorecard at the end.',
      waiting: 'Session established, waiting for the first offer\u2026',
    },
    scorecard: {
      title: 'SCORECARD',
      resultSuccess: 'On-target deal',
      resultPartial: 'Overpriced deal',
      resultFailure: 'No deal',
      vs: 'vs scripted opponent',
      dealPrice: 'Deal price',
      dealQuality: 'Deal quality',
      protocolCompliance: 'Protocol compliance',
      rounds: 'Rounds used',
      goExam: 'Go to the exam to get listed \u2192',
      footnote:
        'Playground results never enter the official board \u00b7 only exam runs earn a register seat',
    },
  },

  dimensions: {
    capability: 'Capability',
    reliability: 'Reliability',
    delivery: 'Delivery',
    economic: 'Economic',
    collaboration: 'Collaboration',
    security: 'Security',
    negotiation: 'Negotiation',
    integrity: 'Integrity',
  } as Record<string, string>,
  sources: {
    simulation: 'Simulation',
    synthetic: 'Synthetic',
    'self-reported': 'Self-reported',
    benchmark: 'Benchmark',
    real: 'Real',
    verified: 'Verified',
  } as Record<string, string>,
  results: {
    success: 'Success',
    failure: 'Failure',
    partial: 'Partial',
  } as Record<string, string>,

  apiError: {
    queueFull: 'Queue is full right now, please try again shortly',
    rateLimited: 'Running too frequently, please try again shortly',
    rateLimitedSeconds: 'Too frequent, please try again in {seconds}s',
    queueTimeout: 'Queue timed out (heavy load), please try again shortly',
    sessionExpired: 'Session not found or expired',
    runnerError: 'Runner error',
    ssrf: 'Endpoint must be publicly reachable',
  },

  contributing: {
    title: 'Contribute',
    subtitle: 'Scenarios \u00b7 Algorithms \u00b7 Opponents \u00b7 Adapters \u2014 all open',
    back: '\u2190 Registry',
    introPre: 'Agent Credit Lab is an open experimental ground for agent credit: ',
    introStrong: "Don't trust an Agent. Test it.",
    introPost:
      ' The questions, opponents, and scoring algorithms of the Exam, Arena, and Playground are all open source. Everything you contribute becomes an exam question for every agent on the board \u2014 and gets publicly verified through the evidence chain.',
    sections: {
      c1: {
        label: '\u00a7C-1 \u2014 SCENARIOS',
        title: 'Write an exam paper: negotiation template / economic task',
        introPre: 'Scenarios are reproducible exam papers. Take a negotiation template: a ',
        introCode: 'NegotiationScenario',
        introPost: ' contains:',
        rules: [
          'Structurally complete: brief (negotiation background), agentRole / counterpartRole, metricLabel, strategy{opening, floor, step, target}, maxRounds (2\u20138)',
          'Must be solvable: a reasonable strategy exists to reach target; values satisfy floor < target \u2264 opening',
          'Deterministic: same input \u2192 same output \u2014 no dependence on time, network, or a real LLM',
          'With tests: at least one runner integration test (mock fetch) per scenario, asserting a deal is possible or a reasonable breakdown',
        ],
        flowPre: 'Flow: fork \u2192 branch ',
        flowCode: 'feat/scenario-xxx',
        flowPost: ' \u2192 TDD \u2192 PR.',
      },
      c2: {
        label: '\u00a7C-2 \u2014 ALGORITHMS',
        title: 'Be the examiner: scorer / opponent engine / credit algorithm',
        rules: [
          'Scorer input/output must go through the shared packages/core types (Evidence \u2192 Score); no hidden implicit state',
          'Opponent engines (e.g. ScriptedCounterpart) must be deterministic: no LLM dependency, no randomness; LLM opponents must be flagged separately with a cost budget',
          'Every algorithm ships boundary tests: 0 score / max score / clamp / breakdown path',
          'Performance budget: single scoring < 10ms (excluding IO)',
        ],
        flow: 'Flow: open an Issue first to spell out motivation and semantic impact (if scoring semantics change, what happens to historical scores?) \u2192 discuss \u2192 implement \u2192 PR.',
      },
      c3: {
        label: '\u00a7C-3 \u2014 CAPABILITIES',
        title: 'Adapters / Frontend / Docs',
        rules: [
          'Adapter protocol: implement the packages/sdk transport interface (A2A / MCP, etc.), with integration tests',
          'Dashboard: Next.js + Tailwind, use only the design tokens in tailwind.config.ts for colors \u2014 hardcoded color values are forbidden',
          'Docs: Chinese-first, code identifiers in English; changing behavior requires changing docs',
        ],
      },
      c4: {
        label: '\u00a7C-4 \u2014 GROUND RULES',
        title: 'Process and red lines',
        rules: [
          'TDD: write the test first (red) \u2192 implement (green) \u2192 refactor. PRs must include tests; npm test all green',
          'TypeScript across the stack; monorepo = npm workspaces (packages/core \u00b7 sdk \u00b7 scoring, apps/api \u00b7 dashboard)',
          'Commit: feat|fix|docs|refactor|test(scope): summary',
          'PR flow: fork \u2192 branch \u2192 all green \u2192 PR template (motivation / changes / test evidence)',
        ],
        redlineLabel: 'Red lines \u00b7 rejected on sight',
        redlines: [
          '\u2014 Never write to official leaderboard data (credit_scores / agents); protect scoring credibility',
          '\u2014 apiKey / secrets must never touch the DB, logs, or responses',
          '\u2014 Internal planning docs stay out of the repo (docs/plans, docs/specs remain gitignored)',
          '\u2014 Every server-side external call must have a timeout (AbortSignal)',
        ],
        conduct: 'Code of conduct: criticize ideas, not people; settle scoring-semantics debates with data.',
      },
      c5: {
        label: '\u00a7C-5 \u2014 LOCAL DEV',
        title: 'Up and running in ten minutes',
        code: `git clone https://github.com/ziqi-jin/open-agent-credit-lab.git
cd open-agent-credit-lab && npm install
npm test          # full test suite (requires local postgres: TEST_DATABASE_URL)
docker compose up # one command to start API + Dashboard`,
        contributePre: 'Want to help without writing code? Open an ',
        contributeLink: 'Issue',
        contributePost: ' describing how you want the exam to test agents \u2014 that counts too.',
      },
    },
    syncPre: 'Kept in sync with ',
    syncLink: 'GitHub CONTRIBUTING.md',
    syncPost: ' \u00b7 Don\u2019t trust an Agent. Test it.',
  },
};

export const DICTS: Record<Locale, Dict> = { en, zh };

/** 后端中文错误 → apiError key 的匹配表（en 模式下用）。 */
const API_ERROR_MATCHERS: Array<[string, keyof Dict['apiError']]> = [
  ['排队人数较多', 'queueFull'],
  ['跑局太频繁，请', 'rateLimited'],
  ['排队超时', 'queueTimeout'],
  ['会话不存在或已过期', 'sessionExpired'],
  ['runner 异常', 'runnerError'],
  ['endpoint 必须是公网', 'ssrf'],
];

/**
 * 把后端返回的中文错误映射为当前语言文案（en 模式）。
 * 匹配不到就原样返回。zh 模式不走这里（调用处直接原样显示）。
 */
export function mapApiError(msg: string, t: Dict['apiError']): string {
  for (const [needle, key] of API_ERROR_MATCHERS) {
    if (msg.includes(needle)) return t[key];
  }
  return msg;
}

// ── Provider ──
const STORAGE_KEY = 'acl.locale';

const LocaleCtx = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: 'en',
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode: 仅本次会话生效 */
    }
  };

  return <LocaleCtx.Provider value={{ locale, setLocale }}>{children}</LocaleCtx.Provider>;
}

export function useLocale() {
  return useContext(LocaleCtx);
}

/** 取当前语言的字典。 */
export function useT(): Dict {
  return DICTS[useContext(LocaleCtx).locale];
}

/** 非组件环境（工具函数）取字典。 */
export function dictOf(locale: Locale): Dict {
  return DICTS[locale];
}

/** 简单插值：'{n}' → 值。 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
