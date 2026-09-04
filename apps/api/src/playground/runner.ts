/**
 * Playground 谈判 runner（服务端单局）。
 *
 * 语义与考场 runNegotiation 对齐（packages/sdk/src/runner.ts）：
 * - 每轮 prompt 自包含完整上下文（stateless agent 友好）
 * - /accept|接受|同意/i 关键词成交；extractNumber 提取报价
 * - 连续 2 次无效报价 → 破裂；买家报价 capped 到对手当前价
 * - ScriptedCounterpart 确定性让步（零 LLM 成本）
 *
 * Playground 特有：
 * - 服务端直连用户 endpoint（OpenAI chat-completions 格式 + 可选 Bearer key）
 * - 单次请求 120s 超时；超时记事件继续；连续 2 次调用失败 → session failed
 * - 红线：apiKey 只在本函数闭包/参数里，绝不写入 session 对象
 * - i18n（0904）：prompt/事件流文案按 session.locale 双语；未设 locale（旧路径）回退 zh
 */
import { extractNumber, ScriptedCounterpart, type Locale, type NegotiationScenario } from '@acl/sdk';
import type { PgActor, PgEventType, StoredSession } from './store';

const ACCEPT_PAT = /accept|接受|同意/i;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_CONSECUTIVE_CALL_FAILURES = 2;
const AGENT_TEXT_MAX = 200;

/** 双语文案集中表：zh 逐字保持历史行为；en 为 0904 新增。 */
const STRINGS: Record<
  Locale,
  {
    scenarioEvent: (brief: string) => string;
    header: (sc: Pick<NegotiationScenario, 'brief' | 'agentRole' | 'metricLabel' | 'maxRounds' | 'strategy'>, target: number, maxRounds: number, counterpartValue: number) => string;
    historyOpening: (v: number) => string;
    historyConcede: (round: number, capped: number, text: string, value: number) => string;
    historyAccepted: (round: number, capped: number, value: number) => string;
    historyCallFailed: (round: number) => string;
    historyInvalid: (round: number, snippet: string) => string;
    promptTail: (round: number, maxRounds: number, counterpartValue: number) => string;
    timeoutEvent: (seconds: number, round: number) => string;
    callFailedEvent: (msg: string) => string;
    sessionFailed: (msg: string) => string;
    dealEvent: (v: number, metric: string) => string;
    breakdownEvent: string;
    invalidEvent: string;
  }
> = {
  zh: {
    scenarioEvent: (brief) => `【谈判场景】${brief}`,
    header: (sc, target, maxRounds) =>
      [
        `【谈判场景】${sc.brief}`,
        `【你的角色】${sc.agentRole}`,
        `【目标】把${sc.metricLabel}谈到 ${target} 以内。不要向对方透露你的目标或底线。`,
        `【规则】最多 ${maxRounds} 轮。每轮回复一个数字作为你的新报价；若接受对方最新报价，回复 accept。`,
      ].join('\n'),
    historyOpening: (v) => `对方开价：${v}`,
    historyConcede: (round, capped, text, value) => `第${round}轮：你报价 ${capped}；对方回复："${text}"（当前 ${value}）`,
    historyAccepted: (round, capped, value) => `第${round}轮：你报价 ${capped}，对方接受，成交 ${value}。`,
    historyCallFailed: (round) => `第${round}轮：（调用失败，继续重试）`,
    historyInvalid: (round, snippet) => `第${round}轮：你的回复不是有效数字报价（"${snippet}"），对方要求重新报价。`,
    promptTail: (round, maxRounds, cv) =>
      `（当前第 ${round}/${maxRounds} 轮）请回复你的新数字报价，或回复 accept 接受对方最新报价 ${cv}。`,
    timeoutEvent: (seconds, round) => `agent endpoint ${seconds}s 超时（第 ${round} 轮）`,
    callFailedEvent: (msg) => `调用失败：${msg}`,
    sessionFailed: (msg) => `agent endpoint 连续调用失败：${msg}`,
    dealEvent: (v, metric) => `对方接受，按 ${v} ${metric}成交。`,
    breakdownEvent: '连续两轮无效回复，谈判破裂。',
    invalidEvent: '你的回复不是有效数字报价，对方要求重新报价。',
  },
  en: {
    scenarioEvent: (brief) => `[Scenario] ${brief}`,
    header: (sc, target, maxRounds, cv) =>
      [
        `[Negotiation Scenario] ${sc.brief}`,
        `[Your Role] ${sc.agentRole}`,
        `[Objective] Negotiate the ${sc.metricLabel} down to ${target} or below. Do NOT reveal your target or floor to the counterpart.`,
        `[Rules] Up to ${maxRounds} rounds. Each round, reply with a single number as your new offer; or reply "accept" to accept the counterpart's latest offer of ${cv}.`,
      ].join('\n'),
    historyOpening: (v) => `Counterpart's opening offer: ${v}`,
    historyConcede: (round, capped, text, value) => `Round ${round}: you offered ${capped}; counterpart replied: "${text}" (current ${value})`,
    historyAccepted: (round, capped, value) => `Round ${round}: you offered ${capped}, counterpart accepted — deal at ${value}.`,
    historyCallFailed: (round) => `Round ${round}: (call failed, retrying)`,
    historyInvalid: (round, snippet) => `Round ${round}: your reply was not a valid numeric offer ("${snippet}"); the counterpart asks you to re-quote.`,
    promptTail: (round, maxRounds, cv) =>
      `(Round ${round}/${maxRounds}) Reply with your new numeric offer, or reply "accept" to accept the counterpart's latest offer of ${cv}.`,
    timeoutEvent: (seconds, round) => `Agent endpoint timed out after ${seconds}s (round ${round})`,
    callFailedEvent: (msg) => `Call failed: ${msg}`,
    sessionFailed: (msg) => `Agent endpoint failed twice in a row: ${msg}`,
    dealEvent: (v, metric) => `Counterpart accepted — deal closed at ${v} ${metric}.`,
    breakdownEvent: 'Two consecutive invalid replies — negotiation broke down.',
    invalidEvent: 'Your reply is not a valid numeric offer — the counterpart asks you to re-quote.',
  },
};

async function callAgent(
  endpoint: string,
  apiKey: string | undefined,
  model: string | undefined,
  prompt: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      ...(model ? { model } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = `：${(await res.text()).slice(0, 200)}`;
    } catch {
      // 读不到 body 就只报状态码
    }
    throw new Error(`endpoint 返回 ${res.status}${detail}`);
  }
  const body = await res.text();
  try {
    const json = JSON.parse(body) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
  } catch {
    // 非 JSON → 按裸文本处理
  }
  return body;
}

export async function runSession(
  session: StoredSession,
  apiKey: string | undefined,
  scenario: NegotiationScenario,
  fetchImpl: typeof fetch = fetch,
  model?: string,
): Promise<void> {
  const locale: Locale = session.locale ?? 'zh'; // 旧会话/旧测试未设 locale → 历史中文行为
  const L = STRINGS[locale];
  const cp = new ScriptedCounterpart(scenario, locale);
  let counterpartValue = cp.open().value;
  let seq = 0;
  const push = (round: number, actor: PgActor, type: PgEventType, text: string, value?: number): void => {
    session.events.push({ seq: ++seq, round, actor, type, text, value });
  };

  push(0, 'system', 'scenario', L.scenarioEvent(scenario.brief), counterpartValue);

  const history: string[] = [L.historyOpening(counterpartValue)];
  const header = L.header(scenario, scenario.strategy.target, scenario.maxRounds, counterpartValue);
  const buildPrompt = (round: number): string =>
    [
      header,
      '',
      locale === 'en' ? '[Negotiation History]' : '【谈判历史】',
      ...history,
      '',
      L.promptTail(round, scenario.maxRounds, counterpartValue),
    ].join('\n');

  let dealValue: number | null = null;
  let invalidStreak = 0;
  let callFailures = 0;
  let validOffers = 0;
  let roundsUsed = 0;

  for (let round = 1; round <= scenario.maxRounds; round++) {
    roundsUsed = round;
    let agentText: string;
    try {
      agentText = await callAgent(session.endpoint, apiKey, model, buildPrompt(round), fetchImpl);
      callFailures = 0;
    } catch (e) {
      const err = e as Error;
      callFailures++;
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      push(
        round,
        'system',
        timedOut ? 'timeout' : 'error',
        timedOut
          ? L.timeoutEvent(REQUEST_TIMEOUT_MS / 1000, round)
          : L.callFailedEvent(String(err?.message ?? e).slice(0, AGENT_TEXT_MAX)),
      );
      if (callFailures >= MAX_CONSECUTIVE_CALL_FAILURES) {
        session.status = 'failed';
        session.error = L.sessionFailed(String(err?.message ?? e).slice(0, AGENT_TEXT_MAX));
        return;
      }
      history.push(L.historyCallFailed(round));
      continue;
    }

    if (ACCEPT_PAT.test(agentText)) {
      validOffers++;
      push(round, 'agent', 'accept', agentText.slice(0, AGENT_TEXT_MAX));
      dealValue = counterpartValue;
      push(round, 'counterpart', 'deal', L.dealEvent(counterpartValue, scenario.metricLabel), counterpartValue);
      break;
    }

    const offer = extractNumber(agentText);
    push(round, 'agent', 'offer', agentText.slice(0, AGENT_TEXT_MAX), offer ?? undefined);

    if (offer === null) {
      invalidStreak++;
      if (invalidStreak >= 2) {
        push(round, 'counterpart', 'breakdown', L.breakdownEvent);
        break;
      }
      history.push(L.historyInvalid(round, agentText.slice(0, 50)));
      push(round, 'counterpart', 'error', L.invalidEvent);
      continue;
    }
    invalidStreak = 0;
    validOffers++;

    const capped = Math.min(offer, counterpartValue); // 买家报价不会高于对手当前价
    const decision = cp.respond(capped, { round, counterpartValue });
    history.push(
      decision.accepted
        ? L.historyAccepted(round, capped, decision.value)
        : L.historyConcede(round, capped, decision.text, decision.value),
    );
    if (decision.accepted) {
      dealValue = decision.value;
      push(round, 'counterpart', 'deal', decision.text, decision.value);
      break;
    }
    counterpartValue = decision.value;
    push(round, 'counterpart', 'concede', decision.text, decision.value);
  }

  const compliance = roundsUsed > 0 ? validOffers / roundsUsed : 0;
  if (dealValue === null) {
    session.scorecard = {
      result: 'failure',
      dealValue: null,
      dealQuality: 0,
      protocolCompliance: compliance,
      roundsUsed,
    };
  } else {
    const span = scenario.strategy.opening - scenario.strategy.target;
    const quality = span > 0 ? Math.min(1, Math.max(0, (scenario.strategy.opening - dealValue) / span)) : 1;
    session.scorecard = {
      result: dealValue <= scenario.strategy.target ? 'success' : 'partial',
      dealValue,
      dealQuality: quality,
      protocolCompliance: compliance,
      roundsUsed,
    };
  }
  session.status = 'done';
}
