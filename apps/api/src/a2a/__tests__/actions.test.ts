import { describe, expect, it } from 'vitest';

import { parseA2aAction, toA2aInbound } from '../actions.js';

/**
 * Task 2: A2A 动作解析器（纯函数，结构化优先 / 文本兜底）。
 * 覆盖：结构化五动作、文本五特征、乱码 → ok:false、DELIVER 缺 artifact → ok:false。
 * 纯函数，无 DB / 无网络依赖。
 */
describe('parseA2aAction — 结构化档（a2tAction data part）', () => {
  it('OFFER: {"type":"OFFER","price":75} → OFFER price=75', () => {
    const r = parseA2aAction({ dataParts: [{ a2tAction: { type: 'OFFER', price: 75 } }] });
    expect(r).toEqual({ ok: true, type: 'OFFER', price: 75 });
  });

  it('NEGOTIATE: {"type":"NEGOTIATE","price":70,"note":"..."} → NEGOTIATE price/note', () => {
    const r = parseA2aAction({
      dataParts: [{ a2tAction: { type: 'NEGOTIATE', price: 70, note: '一起把这事做成，70 行不行' } }],
    });
    expect(r).toEqual({ ok: true, type: 'NEGOTIATE', price: 70, note: '一起把这事做成，70 行不行' });
  });

  it('ACCEPT: {"type":"ACCEPT"} → ACCEPT', () => {
    const r = parseA2aAction({ dataParts: [{ a2tAction: { type: 'ACCEPT' } }] });
    expect(r).toEqual({ ok: true, type: 'ACCEPT' });
  });

  it('REJECT: {"type":"REJECT","reason":"..."} → REJECT（reason 作为 note 透传）', () => {
    const r = parseA2aAction({ dataParts: [{ a2tAction: { type: 'REJECT', reason: '预算不够' } }] });
    expect(r).toEqual({ ok: true, type: 'REJECT', note: '预算不够' });
  });

  it('DELIVER: {"type":"DELIVER","artifact":{...}} → DELIVER artifact（对象直取，不做 sha256 校验）', () => {
    const artifact = { artifactKind: 'patch', sha256: 'abc', uri: 'a2t://reports/1.patch', note: '改好了' };
    const r = parseA2aAction({ dataParts: [{ a2tAction: { type: 'DELIVER', artifact } }] });
    expect(r).toEqual({ ok: true, type: 'DELIVER', artifact });
  });

  it('结构化优先：存在合法 a2tAction 时忽略文本档', () => {
    const r = parseA2aAction({
      dataParts: [{ a2tAction: { type: 'ACCEPT' } }],
      textParts: ['我出 300'],
    });
    expect(r).toEqual({ ok: true, type: 'ACCEPT' });
  });

  it('DELIVER 缺 artifact → ok:false', () => {
    const r = parseA2aAction({ dataParts: [{ a2tAction: { type: 'DELIVER' } }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/artifact/i);
  });

  it('DELIVER artifact 无 artifactKind → ok:false（缺字段才是非法）', () => {
    const r = parseA2aAction({ dataParts: [{ a2tAction: { type: 'DELIVER', artifact: { uri: 'x' } } }] });
    expect(r.ok).toBe(false);
  });

  it('DELIVER artifact 未知 kind → 仍提取为候选对象（T2 只做轻量类型检查，值域归 T5）', () => {
    const r = parseA2aAction({
      dataParts: [{ a2tAction: { type: 'DELIVER', artifact: { artifactKind: 'weird', uri: 'x' } } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type).toBe('DELIVER');
      expect(r.artifact).toMatchObject({ artifactKind: 'weird', uri: 'x' });
    }
  });

  it('asArtifact 返回浅拷贝，不与调用者入参别名', () => {
    const artifact = { artifactKind: 'patch', note: 'n' };
    const r = parseA2aAction({ dataParts: [{ a2tAction: { type: 'DELIVER', artifact } }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.artifact).toEqual(artifact);
      expect(r.artifact).not.toBe(artifact);
    }
  });

  it('结构化非法动作 + 带文本 part（"接受"）→ ok:false（不回退猜文本）', () => {
    const r = parseA2aAction({
      dataParts: [{ a2tAction: { type: 'BOGUS' } }],
      textParts: ['接受'],
    });
    expect(r.ok).toBe(false);
  });

  it('未知 type → ok:false（不猜测）', () => {
    const r = parseA2aAction({ dataParts: [{ a2tAction: { type: 'COUNTER' } }] });
    expect(r.ok).toBe(false);
  });

  it('OFFER/NEGOTIATE 缺合法 price → ok:false', () => {
    expect(parseA2aAction({ dataParts: [{ a2tAction: { type: 'OFFER' } }] }).ok).toBe(false);
    expect(parseA2aAction({ dataParts: [{ a2tAction: { type: 'NEGOTIATE', price: -1 } }] }).ok).toBe(false);
  });

  it('data part 里没有 a2tAction（无关数据）→ 走文本兜底', () => {
    const r = parseA2aAction({ dataParts: [{ foo: 'bar' }], textParts: ['accept'] });
    expect(r).toEqual({ ok: true, type: 'ACCEPT' });
  });
});

describe('parseA2aAction — 文本档（parts[0].text 兜底）', () => {
  it('纯数字 → OFFER(price)', () => {
    expect(parseA2aAction({ textParts: ['75'] })).toEqual({ ok: true, type: 'OFFER', price: 75 });
  });

  it('我出 75 → OFFER(price)', () => {
    expect(parseA2aAction({ textParts: ['我出 75'] })).toEqual({ ok: true, type: 'OFFER', price: 75 });
  });

  it('offer 80 → OFFER(price)', () => {
    expect(parseA2aAction({ textParts: ['offer 80'] })).toEqual({ ok: true, type: 'OFFER', price: 80 });
  });

  it('含“还价 60” → NEGOTIATE(price, note=原文)', () => {
    const r = parseA2aAction({ textParts: ['还价 60，行不行'] });
    expect(r).toEqual({ ok: true, type: 'NEGOTIATE', price: 60, note: '还价 60，行不行' });
  });

  it('含 accept → ACCEPT', () => {
    expect(parseA2aAction({ textParts: ['accept'] })).toEqual({ ok: true, type: 'ACCEPT' });
  });

  it('含“接受”/“成交”/“deal” → ACCEPT', () => {
    for (const t of ['接受', '成交！', 'deal']) {
      expect(parseA2aAction({ textParts: [t] })).toEqual({ ok: true, type: 'ACCEPT' });
    }
  });

  it('含 reject/拒绝 → REJECT（note 透传原文）', () => {
    for (const t of ['reject', '拒绝']) {
      const r = parseA2aAction({ textParts: [t] });
      expect(r).toEqual({ ok: true, type: 'REJECT', note: t });
    }
  });

  it('含“交付”且带 artifact part → DELIVER(artifact)', () => {
    const r = parseA2aAction({
      textParts: ['交付：给你'],
      artifactParts: [{ artifactKind: 'file', uri: 'a2t://out/report.md' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.artifact).toMatchObject({ artifactKind: 'file', uri: 'a2t://out/report.md' });
  });

  it('含交付意图但没有 artifact part → ok:false（不是 DELIVER）', () => {
    const r = parseA2aAction({ textParts: ['给你看看吧'] });
    expect(r.ok).toBe(false);
  });

  it('乱码/空 → ok:false 且 reason 可读', () => {
    for (const t of ['', '   ', '§¶†• 你 在 说 什 么 け', '?!?!?!']) {
      const r = parseA2aAction({ textParts: [t] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('完全没有输入 → ok:false', () => {
    expect(parseA2aAction({}).ok).toBe(false);
  });
});

describe('parseA2aAction — 文本档否定守卫（ACCEPT 分句作用域；REJECT 无守卫）', () => {
  it('正向：接受 / 成交 / 我接受这个价格 → ACCEPT', () => {
    for (const t of ['接受', '成交', '我接受这个价格']) {
      expect(parseA2aAction({ textParts: [t] }), t).toEqual({ ok: true, type: 'ACCEPT' });
    }
  });

  it('同句否定：不接受 / 我今天不想接受这个价格 → ok:false', () => {
    for (const t of ['不接受', '我今天不想接受这个价格']) {
      expect(parseA2aAction({ textParts: [t] }).ok, t).toBe(false);
    }
  });

  it('分句隔离（中文）：否定词在另一分句/假朋友词内 → 不误伤 ACCEPT', () => {
    for (const t of ['没问题，成交', '这个价格不错，成交', '我特别想成交']) {
      expect(parseA2aAction({ textParts: [t] }), t).toEqual({ ok: true, type: 'ACCEPT' });
    }
  });

  it('分句隔离（英文）：no problem, accept / not bad, accept → ACCEPT', () => {
    for (const t of ['no problem, accept', 'not bad, accept']) {
      expect(parseA2aAction({ textParts: [t] }), t).toEqual({ ok: true, type: 'ACCEPT' });
    }
  });

  it('英文同句否定：not / cannot / don\'t / can\'t accept → ok:false', () => {
    for (const t of ['not accept', 'cannot accept', "don't accept", "can't accept"]) {
      expect(parseA2aAction({ textParts: [t] }).ok, t).toBe(false);
    }
  });

  it('deal 词边界：it\'s a deal / we have a deal / 好，deal → ACCEPT；ideal → ok:false', () => {
    for (const t of ["it's a deal", 'we have a deal', '好，deal']) {
      expect(parseA2aAction({ textParts: [t] }), t).toEqual({ ok: true, type: 'ACCEPT' });
    }
    expect(parseA2aAction({ textParts: ['ideal'] }).ok).toBe(false);
  });

  it('拒绝短语：deal breaker / no deal → ok:false', () => {
    for (const t of ['deal breaker', 'no deal']) {
      expect(parseA2aAction({ textParts: [t] }).ok, t).toBe(false);
    }
  });

  it('REJECT 无守卫：拒绝 / reject / 不干了 / 我不干了 → REJECT', () => {
    for (const t of ['拒绝', 'reject', '不干了', '我不干了']) {
      const r = parseA2aAction({ textParts: [t] });
      expect(r.ok, t).toBe(true);
      if (r.ok) expect(r.type).toBe('REJECT');
    }
  });

  it('单独“不” → ok:false', () => {
    expect(parseA2aAction({ textParts: ['不'] }).ok).toBe(false);
  });
});

describe('toA2aInbound — 裸 A2A parts 归一', () => {
  it('拆分 text / data / artifact parts', () => {
    const inbound = toA2aInbound([
      { kind: 'text', text: '我出 75' },
      { kind: 'data', data: { a2tAction: { type: 'ACCEPT' } } },
      { kind: 'artifact', name: 'delivery', parts: [{ kind: 'data', data: { artifactKind: 'patch' } }] },
    ]);
    expect(inbound.textParts).toEqual(['我出 75']);
    expect(inbound.dataParts).toEqual([{ a2tAction: { type: 'ACCEPT' } }]);
    expect(inbound.artifactParts).toHaveLength(1);
  });

  it('parseA2aAction 可直接吃 { parts } 形态', () => {
    const r = parseA2aAction({ parts: [{ kind: 'data', data: { a2tAction: { type: 'OFFER', price: 42 } } }] });
    expect(r).toEqual({ ok: true, type: 'OFFER', price: 42 });
  });
});
