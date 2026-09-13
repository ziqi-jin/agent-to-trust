/**
 * Arena 会话桥 — `sealit join`（Phase 2）。
 *
 * 回合制市场交易：buyer 询价 → 卖方还价/接受 → 交付 → 验收 → 结算。
 * 服务端规则（apps/api/src/routes/arena.ts）：
 *   envelope = { sessionId, seq, type, fromAgent, payload, nonce, ts } + sig + pubkey
 *   7 种事件：OFFER / NEGOTIATE / ACCEPT / REJECT / DELIVER / VERIFY_RESULT / SETTLE
 *   seq 会话内单调（maxSeq+1）；nonce 全局一次性；SETTLE 触发行为证据结算。
 *
 * 文本进出原则不变：把会话状态转成一条 prompt 问 agent，从回复提取 JSON 动作，
 * 提取失败回退 NEGOTIATE（保守续谈）——agent 零协议改动。
 */
import { randomUUID } from 'node:crypto';
import { ensureKeypair, signPayload } from './keys.js';
import type { SealitAgent } from './agent/types.js';

export const ARENA_EVENT_TYPES = [
  'OFFER',
  'NEGOTIATE',
  'ACCEPT',
  'REJECT',
  'DELIVER',
  'VERIFY_RESULT',
  'SETTLE',
] as const;

export type ArenaEventType = (typeof ARENA_EVENT_TYPES)[number];
export type ArenaRole = 'buyer' | 'seller';

/** 会话当前状态快照（发给 agent 的上下文）。 */
export interface ArenaContext {
  role: ArenaRole;
  scenario: string;
  taskSpec: Record<string, unknown> | null;
  budget: number | null;
  deadline: string | null;
  round: number;
  maxRounds: number;
  /** 会话内全部事件（seq 升序，含自己发的）。 */
  events: ArenaEventView[];
}

export interface ArenaEventView {
  seq: number;
  type: string;
  fromAgent: string;
  payload: Record<string, unknown> | null;
  ts: string;
}

export interface ArenaAction {
  type: ArenaEventType;
  payload: Record<string, unknown>;
}

export interface JoinOptions {
  agent: SealitAgent;
  /** 平台 API 地址。 */
  apiBase: string;
  /** 要加入的会话 id（as-xxxx）。不传 → 进入准入队列自动撮合（T12，需考场分达门槛，冷启动 400）。 */
  sessionId?: string;
  name?: string;
  /** 密钥目录（默认 ~/.sealit；同钥即同身份）。 */
  dir?: string;
  /** 模型名（cmd 模式显式上报，榜单展示）。 */
  model?: string;
  /** 被测 agent 软件版本（榜单展示）。 */
  agentVersion?: string;
  maxRounds?: number;
  /** 注入（测试用）。 */
  fetchImpl?: typeof fetch;
  keypair?: { publicKeyPem: string; privateKeyPem: string };
  /** 进度输出（CLI 传 console.log）。 */
  log?: (msg: string) => void;
}

export interface JoinResult {
  agentId: string;
  sessionId: string;
  role: ArenaRole;
  rounds: number;
  finalStatus: string;
  eventsSent: number;
  stoppedReason: 'settled' | 'rejected' | 'idle-timeout' | 'max-rounds' | 'session-closed';
}

/* ------------------------------------------------------------------ */
/* prompt 构造与回复解析                                                */
/* ------------------------------------------------------------------ */

/** 会话上下文 → 一条 prompt（文本进出，agent 零改动）。 */
export function contextToPrompt(ctx: ArenaContext): string {
  const lines: string[] = [];
  lines.push(
    `你是 Agent Credit Lab Arena 里的一名${ctx.role === 'buyer' ? '买家' : '卖家'} agent。` +
      `这是一个回合制市场交易场景：买家询价，卖家报价/交付，买家验收。`,
  );
  lines.push(`场景：${ctx.scenario}`);
  if (ctx.taskSpec) lines.push(`任务说明：${JSON.stringify(ctx.taskSpec)}`);
  if (ctx.budget != null) lines.push(`预算上限：${ctx.budget}`);
  if (ctx.deadline) lines.push(`截止时间：${ctx.deadline}`);
  lines.push(`当前回合：${ctx.round}/${ctx.maxRounds}`);

  if (ctx.events.length === 0) {
    lines.push('会话刚开始，还没有任何消息。');
    if (ctx.role === 'buyer') {
      lines.push('作为买家，请先出价：回复 JSON {"type":"OFFER","payload":{"price":数字,"note":"说明"}}');
    } else {
      lines.push('作为卖家，请等待买家出价（你暂无需动作）。');
    }
  } else {
    lines.push('会话消息记录（seq 升序）：');
    for (const e of ctx.events) {
      lines.push(`  #${e.seq} [${e.type}] ${JSON.stringify(e.payload ?? {})}`);
    }
    lines.push(
      [
        '请根据以上对话决定你的下一步动作，回复一个 JSON 对象：',
        '  {"type":"OFFER","payload":{"price":数字,"note":"…"}}（出价/还价）',
        '  {"type":"NEGOTIATE","payload":{"note":"…"}}（继续磋商，说明诉求）',
        '  {"type":"ACCEPT","payload":{"price":数字}}（接受当前报价，卖家接受后应准备交付）',
        '  {"type":"REJECT","payload":{"reason":"…"}}（终止交易）',
        '  {"type":"DELIVER","payload":{"item":"…","note":"…"}}（卖家交付）',
        '  {"type":"VERIFY_RESULT","payload":{"verdict":"pass|partial|fail","onTime":true|false,"note":"…"}}（买家验收）',
        '  {"type":"SETTLE","payload":{"note":"…"}}（确认完成，触发结算；验收后发）',
        '只回复 JSON，不要其他文字。',
      ].join('\n'),
    );
  }
  return lines.join('\n');
}

/**
 * 从 agent 文本回复提取动作 JSON。
 * 支持：纯 JSON / ```json 围栏 / 文本中最后一个平衡的 {...}；
 * 解析失败或非法 → null（调用方回退 NEGOTIATE）。
 */
export function parseAgentReply(text: string): ArenaAction | null {
  if (!text) return null;
  const candidates: string[] = [];

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  candidates.push(text.trim());

  // 文本中所有平衡大括号片段，取最后一个（通常是最完整的决策）
  const depth: number[] = [];
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      if (start < 0) start = i;
      depth.push(i);
    } else if (c === '}') {
      depth.pop();
      if (depth.length === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  for (const raw of [...candidates].reverse()) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const type = obj.type;
      const payload = obj.payload;
      if (
        typeof type === 'string' &&
        (ARENA_EVENT_TYPES as readonly string[]).includes(type) &&
        payload !== null &&
        typeof payload === 'object' &&
        !Array.isArray(payload)
      ) {
        return { type: type as ArenaEventType, payload: payload as Record<string, unknown> };
      }
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 会话桥主循环                                                         */
/* ------------------------------------------------------------------ */

interface SessionView {
  id: string;
  status: string;
  scenario: string;
  taskSpec: Record<string, unknown> | null;
  budget: number | null;
  deadline: string | null;
  buyerAgentId: string | null;
  sellerAgentId: string | null;
}

interface EventRow {
  seq: number;
  type: string;
  fromAgent: string;
  payload: Record<string, unknown> | null;
  ts: string;
}

/** 简单 fetch 封装：非 2xx 抛错。 */
async function api(
  fetchImpl: typeof fetch,
  base: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(`${base.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`API ${res.status} ${path}: ${JSON.stringify(body)}`);
  }
  return body;
}

/**
 * 准入队列（T12）：POST /arena/queue → 同步撮合或轮询 → sessionId。
 * 门槛（服务端检查）：考场分≥600 且有 real-benchmark 证据。
 * 轮询 3s × 100 ≈ 5 分钟超时；单人排队约 12 秒后由平台对家接单。
 */
async function joinQueue(
  doFetch: typeof fetch,
  base: string,
  name: string,
  pubkeyPem: string,
  log: (msg: string) => void,
  model?: string,
  version?: string,
): Promise<string> {
  log('[sealit] 未指定会话，进入准入队列（门槛：考场分≥400）…');
  const q = await api(doFetch, base, '/arena/queue', {
    method: 'POST',
    body: JSON.stringify({ name, pubkey: pubkeyPem, model, version }),
  });
  if (q.status === 'matched') return q.sessionId as string;
  const ticket = q.ticket as string;
  log(`[sealit] 已排队 ${ticket}，等待撮合（单人约 12 秒后由平台对家接单）…`);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    let s: Record<string, unknown>;
    try {
      s = await api(doFetch, base, `/arena/queue/${ticket}`);
    } catch {
      continue; // 单次网络抖动不放弃
    }
    if (s.status === 'matched') return s.sessionId as string;
  }
  throw new Error('排队超时（约 5 分钟）仍未撮合，稍后重试');
}

/**
 * 加入 Arena 会话并跑到结算（或超时/终止）。
 *
 * - 无 sessionId → 准入队列自动撮合（T12）
 * - buyer 且会话为空：先手出价
 * - 长轮询对家事件（wait 25s，连续 3 次 空 → idle-timeout）
 * - 收到 VERIFY_RESULT：补发 SETTLE（若自己尚未发过）
 * - 收到 SETTLE：直接结束
 */
export async function runJoinLoop(opts: JoinOptions): Promise<JoinResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const log = opts.log ?? (() => {});
  const maxRounds = opts.maxRounds ?? 20;
  const keypair = opts.keypair ?? ensureKeypair(opts.dir);
  const base = opts.apiBase.replace(/\/+$/, '');

  // 1. 钥即身份注册（与考场同一身份体系）
  const reg = await api(doFetch, base, '/arena/register', {
    method: 'POST',
    body: JSON.stringify({
      name: opts.name ?? 'arena-agent',
      pubkey: keypair.publicKeyPem,
      model: opts.model,
      version: opts.agentVersion,
    }),
  });
  const agentId = reg.agentId as string;
  log(`[sealit] 已注册 Arena 身份 ${agentId}${reg.reused ? '（同钥复用）' : ''}`);

  // 2. 会话与角色（无 --session → 准入队列自动撮合）
  const sessionId =
    opts.sessionId ??
    (await joinQueue(
      doFetch,
      base,
      opts.name ?? 'arena-agent',
      keypair.publicKeyPem,
      log,
      opts.model,
      opts.agentVersion,
    ));
  if (!opts.sessionId) log(`[sealit] ✓ 已撮合对手，会话 ${sessionId}`);
  const session = (await api(
    doFetch,
    base,
    `/arena/sessions/${sessionId}`,
  )) as unknown as SessionView;
  const role: ArenaRole = session.buyerAgentId === agentId ? 'buyer' : 'seller';
  if (session.status === 'settled' || session.status === 'failed') {
    return {
      agentId,
      sessionId,
      role,
      rounds: 0,
      finalStatus: session.status,
      eventsSent: 0,
      stoppedReason: 'session-closed',
    };
  }
  if (session.buyerAgentId !== agentId && session.sellerAgentId !== agentId) {
    throw new Error(
      `会话 ${sessionId} 不包含本 agent（buyer=${session.buyerAgentId} seller=${session.sellerAgentId}）`,
    );
  }
  log(`[sealit] 会话 ${sessionId} 场景「${session.scenario}」角色=${role}`);

  // 3. seq 与事件流
  let lastSeq = 0;
  let nextSeq = 1;
  let eventsSent = 0;
  let stoppedReason: JoinResult['stoppedReason'] | null = null;
  let idleEmpty = 0;
  const allEvents: ArenaEventView[] = [];

  const pushEvent = async (action: ArenaAction): Promise<void> => {
    const envelope = {
      sessionId,
      seq: nextSeq,
      type: action.type,
      fromAgent: agentId,
      payload: action.payload,
      nonce: randomUUID(),
      ts: Date.now(),
    };
    const sig = signPayload(keypair.privateKeyPem, envelope);
    try {
      await api(doFetch, base, `/arena/sessions/${sessionId}/events`, {
        method: 'POST',
        body: JSON.stringify({ ...envelope, sig, pubkey: keypair.publicKeyPem }),
      });
    } catch (e) {
      // 409：对家抢先结算 / seq 并发 / nonce 撞车——对家事件已让会话收尾，无害退出
      if (e instanceof Error && e.message.includes('409')) {
        log(`[sealit] #${nextSeq} ${action.type} 被拒（409，会话可能已被对家结算）`);
        stoppedReason = stoppedReason ?? 'settled';
        return;
      }
      throw e;
    }
    allEvents.push({
      seq: envelope.seq,
      type: action.type,
      fromAgent: agentId,
      payload: action.payload,
      ts: new Date(envelope.ts).toISOString(),
    });
    nextSeq += 1;
    eventsSent += 1;
    log(`[sealit] → #${envelope.seq} ${action.type}`);
  };

  /** 问 agent 要下一步动作。 */
  const decide = async (round: number, events: ArenaEventView[]): Promise<ArenaAction> => {
    const prompt = contextToPrompt({
      role,
      scenario: session.scenario,
      taskSpec: session.taskSpec,
      budget: session.budget,
      deadline: session.deadline,
      round,
      maxRounds,
      events,
    });
    const reply = await opts.agent.reply(prompt);
    const action = parseAgentReply(reply);
    if (action) return action;
    log('[sealit] 回复无法解析为动作，回退 NEGOTIATE');
    return { type: 'NEGOTIATE', payload: { note: '（回复格式有误，请重新说明条件）' } };
  };

  // 4. 初始拉取 + buyer 先手
  const initial = (await api(
    doFetch,
    base,
    `/arena/sessions/${sessionId}/events?after=0`,
  )) as unknown as { events: EventRow[] };
  for (const e of initial.events) {
    allEvents.push(e);
    lastSeq = Math.max(lastSeq, e.seq);
  }
  nextSeq = lastSeq + 1;

  if (role === 'buyer' && allEvents.length === 0) {
    log('[sealit] buyer 先手出价…');
    await pushEvent(await decide(1, []));
  } else if (allEvents.some((e) => e.fromAgent !== agentId)) {
    // 排队撮合场景：对家（如平台买家）在 join 前已先手 → 立即决策，不能等下一轮长轮询
    log('[sealit] 对家已先手，立即决策…');
    const action = await decide(1, allEvents);
    await pushEvent(action);
    if (action.type === 'VERIFY_RESULT') {
      const mineSettled = allEvents.some((x) => x.fromAgent === agentId && x.type === 'SETTLE');
      if (!mineSettled) {
        await pushEvent({ type: 'SETTLE', payload: { note: '验收完成，同意结算' } });
      }
      stoppedReason = 'settled';
    }
  }

  // 5. 主循环
  let round = 1;
  while (round <= maxRounds && !stoppedReason) {
    const res = (await api(
      doFetch,
      base,
      `/arena/sessions/${sessionId}/events?after=${lastSeq}&wait=25`,
    )) as unknown as { events: EventRow[] };
    const fresh = res.events;

    if (fresh.length === 0) {
      idleEmpty += 1;
      if (idleEmpty >= 3) {
        stoppedReason = 'idle-timeout';
        break;
      }
      continue;
    }
    idleEmpty = 0;

    let decided = false;
    for (const e of fresh) {
      lastSeq = Math.max(lastSeq, e.seq);
      nextSeq = Math.max(nextSeq, e.seq + 1);
      if (!allEvents.some((x) => x.seq === e.seq)) {
        allEvents.push({
          seq: e.seq,
          type: e.type,
          fromAgent: e.fromAgent,
          payload: e.payload,
          ts: e.ts,
        });
      }

      if (e.fromAgent === agentId) continue; // 自己的（回放）

      if (e.type === 'SETTLE') {
        stoppedReason = 'settled';
        break;
      }
      if (e.type === 'REJECT') {
        stoppedReason = 'rejected';
        break;
      }
      if (e.type === 'VERIFY_RESULT') {
        // 验收完成：补发 SETTLE 触发结算（若自己尚未发过）
        const mineSettled = allEvents.some((x) => x.fromAgent === agentId && x.type === 'SETTLE');
        if (!mineSettled) {
          await pushEvent({ type: 'SETTLE', payload: { note: '验收完成，同意结算' } });
        }
        stoppedReason = 'settled';
        break;
      }
      // 对家业务事件 → 问 agent 决策（每轮限一次，多事件合并决策）
      if (!decided) {
        decided = true;
        const action = await decide(round, allEvents);
        await pushEvent(action);
        // 自己验收通过 → 补发 SETTLE 触发结算（若自己尚未发过）
        if (action.type === 'VERIFY_RESULT') {
          const mineSettled = allEvents.some((x) => x.fromAgent === agentId && x.type === 'SETTLE');
          if (!mineSettled) {
            await pushEvent({ type: 'SETTLE', payload: { note: '验收完成，同意结算' } });
          }
          stoppedReason = 'settled';
          break;
        }
      }
    }
    if (stoppedReason) break;
    round += 1;
  }

  if (!stoppedReason) stoppedReason = 'max-rounds';

  // 6. 终态确认
  let finalStatus = 'unknown';
  try {
    const s = (await api(doFetch, base, `/arena/sessions/${sessionId}`)) as unknown as SessionView;
    finalStatus = s.status;
  } catch {
    /* 会话可能已关 */
  }

  return {
    agentId,
    sessionId,
    role,
    rounds: round,
    finalStatus,
    eventsSent,
    stoppedReason,
  };
}
