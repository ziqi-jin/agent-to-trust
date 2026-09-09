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
 * 与 capability/behavior 榜（审计 A3）显式排除；本过滤器沿用既有 publicAgentFilter
 * 语义（不含 PLATFORM_NAME），以对齐 0909 拍板目标 EXAMINED=31。
 */
import { and, ilike, like, ne, not } from 'drizzle-orm';
import { agents } from '../db/schema';

/** 平台保留名（内部哨兵账号，绝不进公开面）。 */
export const RESERVED_PLATFORM_NAME = '__platform__';

/** 公开面 agent 过滤：仿真号 / E2E 号 / 平台保留名一律剔除。 */
export const publicAgentFilter = and(
  not(ilike(agents.name, 'e2e%')),
  not(like(agents.name, 'sim-agent-%')),
  ne(agents.name, RESERVED_PLATFORM_NAME),
);
