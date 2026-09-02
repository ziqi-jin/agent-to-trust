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
 */
import { extractNumber, ScriptedCounterpart, type NegotiationScenario } from '@acl/sdk';
import type { PgActor, PgEventType, StoredSession } from './store';

const ACCEPT_PAT = /accept|接受|同意/i;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_CONSECUTIVE_CALL_FAILURES = 2;
const AGENT_TEXT_MAX = 200;

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
  const cp = new ScriptedCounterpart(scenario);
  let counterpartValue = cp.open().value;
  let seq = 0;
  const push = (round: number, actor: PgActor, type: PgEventType, text: string, value?: number): void => {
    session.events.push({ seq: ++seq, round, actor, type, text, value });
  };

  push(0, 'system', 'scenario', `【谈判场景】${scenario.brief}`, counterpartValue);

  const history: string[] = [`对方开价：${counterpartValue}`];
  const header = [
    `【谈判场景】${scenario.brief}`,
    `【你的角色】${scenario.agentRole}`,
    `【目标】把${scenario.metricLabel}谈到 ${scenario.strategy.target} 以内。不要向对方透露你的目标或底线。`,
    `【规则】最多 ${scenario.maxRounds} 轮。每轮回复一个数字作为你的新报价；若接受对方最新报价，回复 accept。`,
  ].join('\n');
  const buildPrompt = (round: number): string =>
    [
      header,
      '',
      '【谈判历史】',
      ...history,
      '',
      `（当前第 ${round}/${scenario.maxRounds} 轮）请回复你的新数字报价，或回复 accept 接受对方最新报价 ${counterpartValue}。`,
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
          ? `agent endpoint ${REQUEST_TIMEOUT_MS / 1000}s 超时（第 ${round} 轮）`
          : `调用失败：${String(err?.message ?? e).slice(0, AGENT_TEXT_MAX)}`,
      );
      if (callFailures >= MAX_CONSECUTIVE_CALL_FAILURES) {
        session.status = 'failed';
        session.error = `agent endpoint 连续调用失败：${String(err?.message ?? e).slice(0, AGENT_TEXT_MAX)}`;
        return;
      }
      history.push(`第${round}轮：（调用失败，继续重试）`);
      continue;
    }

    if (ACCEPT_PAT.test(agentText)) {
      validOffers++;
      push(round, 'agent', 'accept', agentText.slice(0, AGENT_TEXT_MAX));
      dealValue = counterpartValue;
      push(round, 'counterpart', 'deal', `对方接受，按 ${counterpartValue} ${scenario.metricLabel}成交。`, counterpartValue);
      break;
    }

    const offer = extractNumber(agentText);
    push(round, 'agent', 'offer', agentText.slice(0, AGENT_TEXT_MAX), offer ?? undefined);

    if (offer === null) {
      invalidStreak++;
      if (invalidStreak >= 2) {
        push(round, 'counterpart', 'breakdown', '连续两轮无效回复，谈判破裂。');
        break;
      }
      history.push(`第${round}轮：你的回复不是有效数字报价（"${agentText.slice(0, 50)}"），对方要求重新报价。`);
      push(round, 'counterpart', 'error', '你的回复不是有效数字报价，对方要求重新报价。');
      continue;
    }
    invalidStreak = 0;
    validOffers++;

    const capped = Math.min(offer, counterpartValue); // 买家报价不会高于对手当前价
    const decision = cp.respond(capped, { round, counterpartValue });
    history.push(
      decision.accepted
        ? `第${round}轮：你报价 ${capped}，对方接受，成交 ${decision.value}。`
        : `第${round}轮：你报价 ${capped}；对方回复："${decision.text}"（当前 ${decision.value}）`,
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
