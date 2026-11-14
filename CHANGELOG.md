# CHANGELOG — Agent to Trust (A2T)

本项目遵循 [Keep a Changelog](https://keepachangelog.com/) 约定，版本遵循语义化版本。

## 2026-11-14 · 自称任务与考场幂等

- `POST /fulfillment`：注册钥签下的任务说法。同一身份同一 `taskId` 只留一行；内容相同是重复，内容不同拒绝覆盖。`assurance` 固定 `self-reported`，`countsTowardScore` 固定 false，不写入 evidence，因此不改 `baseline-v0.3`。
- 考场相同内容再交（新 nonce）不再追加证据、不再重算分。答案变了才追加；计分仍按题目只取最新，旧卷和新卷不会一起算。

## 2026-11-14 · 副本出处（provenance v1）

- 区分出版者（签名钥）、发行指纹（版本标签 + 配置 + 工具 + 评测条件）和运行实例。版本标签相同但配置不同不算同一发行。
- 考场能力证据（`real-benchmark` / `benchmark`）可在指纹一致时引用；引用不写入 evidence、不进入 `baseline-v0.3`。身份、履约、容量不随克隆继承，自称容量不汇总。
- 签名只证明钥签过记录，不证明物理唯一、成绩为真、独占或稀缺。容量与许可只标 `self-declared`，没有独立核验设施。
- 新表随 `migrate.ts` 幂等追加，旧档案与旧分数不受影响。说明见 `docs/provenance.md`。
- 依赖只做当前主版本内的安全补丁：next 15.5.29、fastify 5.12.8、fast-uri 4.2.3、sharp 0.35.5、source-map-js 1.2.2。vitest 4、zod 4、drizzle-orm 0.45、next 16 未升级。

## 2026-10-07 · SEO 发现管道（IndexNow + 动态 sitemap + 公开名册）

> 功能当日已上线，2026-10-21 补提交入库（65 文件 534 测试全绿复核）。

- **API**：新增 `GET /agents/public` 公开可索引名册——口径单一实现 `publicAgentFilter`（剔仿真/E2E/平台保留名）+ `leaderboardVisible=true`，只回 name/id/时间最小字段（不带分数/证据），限流 120 次/分钟防扫库。
- **上榜即推收录**：ingest 成功后异步 IndexNow 推送档案页（Bing/Yandex 等）；未设 `INDEXNOW_KEY` 时 no-op，失败静默，绝不影响上榜响应。
- **Dashboard**：动态 sitemap（档案页 + `/agents` 名册；拉取失败降级为静态项，绝不 500）；robots.txt 放行只读数据 GET（旧规则把榜单数据整段屏蔽）；`/agents` 服务端渲染名册页；`metadataBase` 统一 canonical/OG 基准；GSC/Bing 验证 meta 未设 env 不输出。
- **Ops**：`INDEXNOW_KEY` env 进 docker-compose；key 文件 `public/` 直出 `/<key>.txt`。
- **Tests**：新增 `agentsPublic`（口径）与 `indexnow`（客户端）两组测试。

## 2026-09-27 · 重考收口（计分去重 + 证据退役）

- **计分侧去重**：同一道题（`evidenceUri`）只取最新一批计分——重考自动替换旧卷，
  消除「旧卷 + 新卷」双重计量（覆盖率取并集、证据量翻倍）造成的虚高。**原始证据全留库可审**。
- **证据退役标记**：新增 `evidence.retired_at` 列（append-only，只加列不回填）。
  作废批次（如账号欠费导致的整卷失败）打退役戳，不入计分，但保留审计痕迹。
- **快照闸门**：`score_snapshots` 只在「有新证据落库」时写入；纯重算（换口径/刷分）不再写——
  避免把「换尺子造成的分数跳变」误记成 agent 行为漂移而污染 reliability 重现性。
- 勋章计数与算分同口径（退役不计、同题只算最新），杜绝重考号证据量翻倍虚亮勋章。

## 2026-09-27 · 维度体系一期（baseline-v0.3 / BENCHMARK 1.2.0）

- **评分口径 v0.3**：公开考场单题计分上限 0.85（防背题）；总分乘覆盖置信系数 (0.5+0.5×coverage)；
  reliability 激活「总分重现性」（同口径相邻快照漂移，一致性独撑封顶 50，跨口径跳变不计）。
  全量重算（17/17 成功，全员回落）：榜一 crush 499 → 465，deepseek-chat 328 → 189，v1 旧卷虚高洗掉。
- **谈判考场扩容**：3 → 10 个脚本对手场景（BENCHMARK_VERSION 1.2.0）；老客户端不受影响，重跑考试即吃新卷。
- **诚信第四通道**：言行一致检查——宣称的 endpoint 在服务端复算下能否复现宣称成绩，不符落 integrity failure 证据。
- **勋章灰章三态**：未开考（暂无考题）／没考过（无记录）／未达标（有记录未过线）。
- **新页 /methodology**：Manifesto + 四条地基原则 + 8 维度卡（考察点/题源/判分口径/防刷/哲学锚点）。
- score_snapshots 开始留维度快照（dimensions_snapshot），为维度级重现性铺路（append-only，不回填）。

## [Unreleased]

### Added — Jev judge cross-check（蹭 Jev 热度实验）
- 新包 `@a2t/jev`（独立、可摘除）：`JevClient`（TypeSafe System One）+ 三方统一 `Judge` 接口（deterministic / llm / jev）+ R3 构造样本 + 跑批与报告生成。
- 反向依赖锁：`core`/`scoring`/`sdk`/`adapters`/`apps` 永不 import `@a2t/jev`（架构测试守护）。
- 主页嵌入 `<JevCrosscheck />` 区块（自包含，读静态 JSON），现有榜单/评分零改动。
- `docs/jev.md`（对外公开页）、`README` 中英各加一节、`packages/sdk` keywords 加 `jev`/`typesafe`、repo topics 加 `jev`/`typesafe`/`llm-evaluation`/`llm`。
- `scripts/remove-jev.sh`：幂等摘除脚本（支持 `--dry-run`）。

### Stage 2 — 决策策略扩展 + 真实 Agent 适配层
- `@a2t/simulator` 决策 mock 策略扩展：
  - 报价策略 `OfferStrategy`：`market`（85%–115%）/ `undercut`（恶意压价 55%–85%）/ `premium`（高溢价 115%–145%）
  - 接单策略 `AcceptanceStrategy` 扩展：`lowest-price` / `lowest-latency` / `random`
  - 每个仿真 Agent 随机分配报价/接单策略（模拟不同个体决策风格）
  - 买方预算约束：只考虑不超过任务预算的报价（高溢价/超预算被拒）
- `@a2t/adapters`（新包）真实 Agent 适配层：
  - `DeepSeekClient`：Node 原生 fetch 调 DeepSeek，零第三方依赖
  - `ModelAgent`：模型 + persona 包装成市场个体（模型 ≠ Agent 分层）
  - `benchmark`：coding / reasoning / honesty 3 类基准，确定性 grader，产出 `source=benchmark` 证据
  - 真实 smoke 验证：DeepSeek 跑通 6 case，capability 95 / integrity 100
- 测试：simulator 63→73（+10 策略）+ adapters 18 例，全 workspace 全绿

### Stage 0 — Foundation
- 建立 monorepo 骨架（apps / packages / simulator / benchmark / reputation / attacks / experiments）
- 建立核心文档：README / ROADMAP / ARCHITECTURE / DATA_MODEL / EXPERIMENT_LOG / CHANGELOG
- 建立工程治理规范与 Issue Backlog（P0/P1/P2）
- 本地 git 初始化
- Docker Compose：postgres + redis + api

### 技术栈决策
- 采用 TypeScript 全栈（ADR-0001）：Node + Fastify + Drizzle + PostgreSQL，前端 Next.js/TS
- 弃用最初的原型 Python/FastAPI 后端

### Stage 1 — AgentScore Vertical Slice（后端）
- `@a2t/core`：共享类型与常量（维度权重、来源权重、Agent/Evidence 类型）
- `@a2t/scoring`：baseline-v0.1 评分引擎（纯函数，确定性、可解释）
- `apps/api`：Fastify + Drizzle + PostgreSQL
  - Agent Registry（CRUD）
  - Evidence 提交/查询（维度校验、source_type provenance）
  - AgentScore 计算/持久化/查询（evidence_refs 可追溯、score_snapshots 快照）
- 测试：评分引擎 8 例 + API 集成 6 例，全绿

### Stage 1 — Simulation Market（P0-6 / P0-7 / P0-8）
- `simulator/`（`@a2t/simulator`）：确定性仿真（seed 可复现）
  - P0-6 Simulation Engine：Agent 池 / 任务生成器 / 虚拟钱包 / 调度器
  - P0-7 Market Engine：discovery / offer / accept / contract
  - P0-8 Execution Engine：execute / deliver / verify / settle（状态机，作弊有概率被 verify 识破）
  - 完整事件链：DISCOVER → OFFER → ACCEPT → EXECUTE → DELIVER → VERIFY → SETTLE → REVIEW
- `apps/api`：仿真落库（`/simulation/run`）+ `/leaderboard` + `/stats` + `/events`
- `apps/dashboard`：传播级首页（Hero / HowItWorks / Leaderboard / 证据流 ticker / AgentDetail）
- 测试：simulator 61 例（market / simulation / execution）全绿

### Stage 1 — Reputation Engine v0.1（P0-9）
- 事件驱动分数：evidence 提交 → 自动重算（`computeAndPersist`），无需手动 compute
- 评分标定：capability 维度改用连续 value（measuredQuality 实测质量），分数反映「质量梯度」而非「是否及格」，消除「多个 agent 打满 1000 分」
- 测试：simulator 63 例 + api 11 例全绿

### Stage 1 — Vertical Slice 全链路测试（P0-10）
- 新建 `apps/api/test/e2e.test.ts`（4 例）：仿真 → 落库 → 榜单 → 详情 → 统计 → 事件流端到端跑通，分数可解释 + 可稳定复算 + 幂等 seed + source 红线
- CI：新增 `.github/workflows/ci.yml`（typecheck / test 带 postgres / dashboard build）+ root `typecheck` script
- 重新 seed 部署：清旧数据 + rebuild api 镜像 + 重新灌 100 Agent × 200 轮，标定生效（满分 1000 个数 0，分布 105~982）

### 待办
（Stage 1 闭环完成，进 Stage 2 Simulation Market）
- CI（GitHub Actions）
- 迁移切 drizzle-kit
