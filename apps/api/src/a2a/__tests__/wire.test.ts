import { describe, expect, it } from 'vitest';

import type { A2aPart } from '../client.js';
import type { ParsedAction } from '../actions.js';
import {
  normalizeArtifact,
  fromParsedAction,
  toA2aMessage,
  type KernelEvent,
} from '../wire.js';

/**
 * Task 5: 事件翻译（wire）— 内核 7 事件 ↔ A2A 消息的翻译防腐层。
 * 出站：内核事件 → 自包含文本 + 结构化 metadata（round/deadlineMs/sessionId）。
 * 入站：ParsedAction → 内核事件载荷；artifact 归一化 + 值域/字段校验（Ruling 1）。
 * 纯函数、零 I/O、零 DB。
 */

// —— 出站 ——

describe('toA2aMessage — 出站（自包含文本 + metadata）', () => {
  it('OFFER：text 含价格，metadata.acl 的 sessionId/round/deadlineMs 正确', () => {
    const event: KernelEvent = { type: 'OFFER', payload: { price: 80 }, sessionId: 'sess-1', seq: 2 };
    const msg = toA2aMessage(event, []);

    expect(msg.text).toContain('80');
    expect(msg.metadata.acl).toEqual({ sessionId: 'sess-1', round: 2, deadlineMs: 60_000 });
  });

  it('带 history：text 自包含（含最近历史摘要）', () => {
    const event: KernelEvent = { type: 'OFFER', payload: { price: 80 }, sessionId: 'sess-1', seq: 2 };
    const history: KernelEvent[] = [
      { type: 'OFFER', payload: { price: 72 }, sessionId: 'sess-1', seq: 1 },
    ];
    const msg = toA2aMessage(event, history);

    expect(msg.text).toContain('80');
    expect(msg.text).toContain('72'); // 历史摘要进入文本 → 无状态 agent 也能接
  });

  it('deadlineMs 默认 60_000', () => {
    const msg = toA2aMessage({ type: 'ACCEPT', payload: {} }, []);
    expect(msg.metadata.acl.deadlineMs).toBe(60_000);
  });

  it('round 兜底：无 seq 时用 history 计数 + 1', () => {
    const history: KernelEvent[] = [{ type: 'OFFER', payload: { price: 72 }, seq: 1 }];
    const msg = toA2aMessage({ type: 'NEGOTIATE', payload: { price: 70 } }, history);
    expect(msg.metadata.acl.round).toBe(2);
  });

  it('五事件各有明确文案（OFFER/NEGOTIATE/ACCEPT/REJECT/DELIVER）', () => {
    const texts = (['OFFER', 'NEGOTIATE', 'ACCEPT', 'REJECT', 'DELIVER'] as const).map(
      (type) => toA2aMessage({ type, payload: { price: 75 } }, []).text,
    );
    for (const t of texts) expect(t.trim().length).toBeGreaterThan(0);
    // 五事件文案互不相同
    expect(new Set(texts).size).toBe(5);
  });

  it('VERIFY_RESULT / SETTLE 有兜底文案且不抛', () => {
    expect(toA2aMessage({ type: 'VERIFY_RESULT', payload: {} }, []).text.trim().length).toBeGreaterThan(0);
    expect(toA2aMessage({ type: 'SETTLE', payload: {} }, []).text.trim().length).toBeGreaterThan(0);
  });
});

// —— 入站：ParsedAction → 内核事件载荷 ——

describe('fromParsedAction — 入站映射', () => {
  it('OFFER → { type:OFFER, payload:{price} }', () => {
    expect(fromParsedAction({ ok: true, type: 'OFFER', price: 75 })).toEqual({
      type: 'OFFER',
      payload: { price: 75 },
    });
  });

  it('NEGOTIATE → { type:NEGOTIATE, payload:{price,note} }', () => {
    expect(fromParsedAction({ ok: true, type: 'NEGOTIATE', price: 70, note: '成交吧' })).toEqual({
      type: 'NEGOTIATE',
      payload: { price: 70, note: '成交吧' },
    });
  });

  it('ACCEPT → { type:ACCEPT, payload:{} }', () => {
    expect(fromParsedAction({ ok: true, type: 'ACCEPT' })).toEqual({ type: 'ACCEPT', payload: {} });
  });

  it('REJECT → { type:REJECT, payload:{reason} }', () => {
    expect(fromParsedAction({ ok: true, type: 'REJECT', note: '预算不够' })).toEqual({
      type: 'REJECT',
      payload: { reason: '预算不够' },
    });
  });

  it('DELIVER → { type:DELIVER, payload:{artifact} }（artifact 透传）', () => {
    const artifact = { artifactKind: 'patch' as const, sha256: 'a'.repeat(64), uri: 'acl://x.patch' };
    const r = fromParsedAction({ ok: true, type: 'DELIVER', artifact });
    expect(r).toEqual({ type: 'DELIVER', payload: { artifact } });
    expect((r?.payload as { artifact: unknown }).artifact).toBe(artifact);
  });

  it('ok:false → null（调用方据此计 invalid_rounds）', () => {
    const bad: ParsedAction = { ok: false, reason: '无法解析' };
    expect(fromParsedAction(bad)).toBeNull();
  });
});

// —— 入站：artifact 归一化 + 校验（Ruling 1） ——

function deliveryPart(data: unknown): A2aPart {
  return { kind: 'artifact', name: 'delivery', parts: [{ kind: 'data', data }] } as A2aPart;
}

describe('normalizeArtifact — 归一化 + 值域/字段校验（Ruling 1）', () => {
  it('合法 delivery artifact → 归一化对象', () => {
    const parts = [
      deliveryPart({
        artifactKind: 'patch',
        sha256: 'a'.repeat(64),
        uri: 'acl://reports/1.patch',
        note: '改好了',
      }),
    ];
    expect(normalizeArtifact(parts)).toEqual({
      artifactKind: 'patch',
      sha256: 'a'.repeat(64),
      uri: 'acl://reports/1.patch',
      note: '改好了',
    });
  });

  it('unknown artifactKind → null', () => {
    expect(
      normalizeArtifact([deliveryPart({ artifactKind: 'wormhole', uri: 'acl://x' })]),
    ).toBeNull();
  });

  it('缺 artifactKind → null', () => {
    expect(normalizeArtifact([deliveryPart({ uri: 'acl://x' })])).toBeNull();
  });

  it('无 uri 且无 inline → null', () => {
    expect(
      normalizeArtifact([deliveryPart({ artifactKind: 'text', sha256: 'a'.repeat(64) })]),
    ).toBeNull();
  });

  it('sha256 非 64 位 hex → null', () => {
    expect(
      normalizeArtifact([
        deliveryPart({ artifactKind: 'patch', sha256: 'not-a-hash', uri: 'acl://x' }),
      ]),
    ).toBeNull();
  });

  it('parts 里没有 delivery artifact → null', () => {
    expect(normalizeArtifact([{ kind: 'text', text: '我只是说句话' } as A2aPart])).toBeNull();
    expect(normalizeArtifact([])).toBeNull();
  });

  it('inline 可用（无 uri）→ 合法', () => {
    expect(normalizeArtifact([deliveryPart({ artifactKind: 'text', inline: 'hello' })])).toEqual({
      artifactKind: 'text',
      inline: 'hello',
    });
  });
});
