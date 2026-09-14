/**
 * 公开口径（门面展示）共享过滤器 —— 单一实现，防口径漂移。
 *
 * 2026-09-09 13:17 老大拍板（D1【EXAMINED→31】）：
 * EXAMINED = 公开登记且持分的真实 agent 数（=31）。报头 EXAMINED 一度 =160
 * （31 公开 + 100 仿真 + 29 狗粮）——因为 /stats/summary 的 lb1 只过滤了
 * `leaderboard_visible`，没排仿真号 / E2E 号 / 平台保留名，与 /stats?scope=public、
 * /events?scope=public 的门面口径打架（0907 走查「数字对不上账」同款病）。
 *
 * 排除：
 *  - `sim-agent-%`：@acl/simulator 落库的仿真号；
 *  - `e2e%`（ILIKE，大小写不敏感前缀）：E2E 测试号（审计 B4 统一口径）；
 *  - `__platform__`：平台保留名（内部哨兵账号，绝不进公开面）。
 *
 * 注：线上平台对家实名 `arena-buyer-platform`（PLATFORM_NAME）已在 lb2（stats.ts）
 * 与 capability/behavior 榜（审计 A3）显式排除。
 *
 * 2026-09-14 补（RELEASE_CHECKLIST §2「首页大数字对账」）：live 对局上线后，平台对家
 * 当 buyer 结算会拿到信用分（arenaSettle 给 buyer 记 reliability），于是被 publicAgentFilter
 * 计入报头 EXAMINED/REGISTERED，而榜1 按名排除它 → 报头 7 / 榜单 6 对不上账。
 * 修法：本过滤器一并排 PLATFORM_NAME，与榜1 / lb2 同一口径（单一实现，防口径漂移）。
 */
import { and, ilike, like, ne, not } from 'drizzle-orm';
import { agents } from '../db/schema';
import { PLATFORM_NAME } from './arenaQueue';

/** 平台保留名（内部哨兵账号，绝不进公开面）。 */
export const RESERVED_PLATFORM_NAME = '__platform__';

/** 公开面 agent 过滤：仿真号 / E2E 号 / 平台保留名（哨兵 + 实名平台对家）一律剔除。 */
export const publicAgentFilter = and(
  not(ilike(agents.name, 'e2e%')),
  not(like(agents.name, 'sim-agent-%')),
  ne(agents.name, RESERVED_PLATFORM_NAME),
  ne(agents.name, PLATFORM_NAME),
);
