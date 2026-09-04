/**
 * Playground 场景解析与校验（TDD）。
 * 红线：SSRF 防护（私网/环回拒绝）、floor < target ≤ opening、key 不参与校验存储。
 */
import { describe, expect, it } from 'vitest';
import { isPublicEndpoint, validateSessionInput } from '../scenario';

const validCustom = {
  brief: '你要采购一批咖啡豆，正在和供应商谈单价。',
  agentRole: '咖啡馆主',
  counterpartRole: '豆商',
  metricLabel: '单价（元/kg）',
  opening: 100,
  floor: 60,
  target: 75,
  maxRounds: 5,
  style: 'balanced' as const,
};

describe('validateSessionInput', () => {
  it('模板命中 → 直接用官方场景', () => {
    const r = validateSessionInput({ endpoint: 'https://api.example.com/chat', scenario: { templateId: 'neg-keyboard-price' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scenario.id).toBe('neg-keyboard-price');
      expect(r.value.name).toBe('anonymous');
    }
  });

  it('templateId 不存在且无 custom → 报错', () => {
    const r = validateSessionInput({ endpoint: 'https://api.example.com/chat', scenario: { templateId: 'no-such' } });
    expect(r.ok).toBe(false);
  });

  it('custom 场景：balanced → step = (opening-floor)×0.25', () => {
    const r = validateSessionInput({ endpoint: 'https://api.example.com/chat', scenario: { custom: validCustom } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scenario.strategy.step).toBeCloseTo(10); // (100-60)×0.25
      expect(r.value.scenario.strategy.target).toBe(75);
      expect(r.value.scenario.maxRounds).toBe(5);
    }
  });

  it('风格三档映射：tough 0.10 / gentle 0.40；step 下限 0.5', () => {
    const tough = validateSessionInput({ endpoint: 'https://api.example.com/chat', scenario: { custom: { ...validCustom, style: 'tough' } } });
    expect(tough.ok && tough.value.scenario.strategy.step).toBeCloseTo(4);
    const gentle = validateSessionInput({ endpoint: 'https://api.example.com/chat', scenario: { custom: { ...validCustom, style: 'gentle' } } });
    expect(gentle.ok && gentle.value.scenario.strategy.step).toBeCloseTo(16);
    // 极窄区间 → step 钉在 0.5
    const narrow = validateSessionInput({
      endpoint: 'https://api.example.com/chat',
      scenario: { custom: { ...validCustom, opening: 10, floor: 9.8, target: 9.9, style: 'tough' } },
    });
    expect(narrow.ok && narrow.value.scenario.strategy.step).toBeCloseTo(0.5);
  });

  it('maxRounds 缺省 4；越界（1 / 9）报错', () => {
    const def = validateSessionInput({ endpoint: 'https://a.com/x', scenario: { custom: { ...validCustom, maxRounds: undefined } } });
    expect(def.ok && def.value.scenario.maxRounds).toBe(4);
    expect(validateSessionInput({ endpoint: 'https://a.com/x', scenario: { custom: { ...validCustom, maxRounds: 1 } } }).ok).toBe(false);
    expect(validateSessionInput({ endpoint: 'https://a.com/x', scenario: { custom: { ...validCustom, maxRounds: 9 } } }).ok).toBe(false);
  });

  it('custom 缺字段 / 数值关系违例 → 报错', () => {
    expect(validateSessionInput({ endpoint: 'https://a.com/x', scenario: { custom: { ...validCustom, brief: undefined as unknown as string } } }).ok).toBe(false);
    expect(validateSessionInput({ endpoint: 'https://a.com/x', scenario: { custom: { ...validCustom, floor: 80 } } }).ok).toBe(false); // floor ≥ target
    expect(validateSessionInput({ endpoint: 'https://a.com/x', scenario: { custom: { ...validCustom, target: 120 } } }).ok).toBe(false); // target > opening
    expect(validateSessionInput({ endpoint: 'https://a.com/x', scenario: { custom: { ...validCustom, floor: 0 } } }).ok).toBe(false);
    expect(validateSessionInput({ endpoint: 'https://a.com/x', scenario: { custom: { ...validCustom, style: 'wild' as never } } }).ok).toBe(false);
  });

  it('scenario 既无 templateId 也无 custom → 报错；两者同给 → 模板优先', () => {
    expect(validateSessionInput({ endpoint: 'https://a.com/x', scenario: {} }).ok).toBe(false);
    const both = validateSessionInput({ endpoint: 'https://a.com/x', scenario: { templateId: 'neg-delivery-days', custom: validCustom } });
    expect(both.ok && both.value.scenario.id).toBe('neg-delivery-days');
  });

  it('name 缺省 anonymous；超 60 字符截断；apiKey 透传', () => {
    const r = validateSessionInput({ name: 'x'.repeat(80), endpoint: 'https://a.com/x', apiKey: 'sk-test', scenario: { templateId: 'neg-keyboard-price' } });
    expect(r.ok && r.value.name).toHaveLength(60);
    expect(r.ok && r.value.apiKey).toBe('sk-test');
  });

  // ── 0904 i18n：locale 默认 en + 模板 EN materialize ──

  it('locale 缺省/非法 → en；显式 zh 保留', () => {
    const def = validateSessionInput({ endpoint: 'https://a.com/x', scenario: { templateId: 'neg-keyboard-price' } });
    expect(def.ok && def.value.locale).toBe('en');
    const bad = validateSessionInput({ endpoint: 'https://a.com/x', locale: 'fr' as never, scenario: { templateId: 'neg-keyboard-price' } });
    expect(bad.ok && bad.value.locale).toBe('en');
    const zh = validateSessionInput({ endpoint: 'https://a.com/x', locale: 'zh', scenario: { templateId: 'neg-keyboard-price' } });
    expect(zh.ok && zh.value.locale).toBe('zh');
  });

  it('locale=en → 官方模板 materialize 成英文文案（strategy/id/maxRounds 不动）', () => {
    const r = validateSessionInput({ endpoint: 'https://a.com/x', scenario: { templateId: 'neg-keyboard-price' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scenario.brief).toMatch(/^You are sourcing 100 custom mechanical keyboards/);
      expect(r.value.scenario.agentRole).toBe('Procurement Manager');
      expect(r.value.scenario.counterpartRole).toBe('Supplier Sales Rep');
      expect(r.value.scenario.metricLabel).toBe('Unit price (CNY)');
      expect(r.value.scenario.strategy).toEqual({ opening: 100, floor: 55, step: 15, target: 65 });
      expect(r.value.scenario.maxRounds).toBe(4);
    }
  });

  it('locale=zh → 官方模板保持中文源文案', () => {
    const r = validateSessionInput({ endpoint: 'https://a.com/x', locale: 'zh', scenario: { templateId: 'neg-keyboard-price' } });
    expect(r.ok && r.value.scenario.brief).toBe('你要为公司采购 100 把定制机械键盘，正在和供应商谈单价。市场参考价约 90 元。');
  });

  it('custom 场景内容原样（用户自己输的），locale 照带', () => {
    const r = validateSessionInput({ endpoint: 'https://a.com/x', locale: 'en', scenario: { custom: validCustom } });
    expect(r.ok && r.value.scenario.brief).toBe(validCustom.brief);
    expect(r.ok && r.value.locale).toBe('en');
  });
});

describe('isPublicEndpoint（SSRF 防护）', () => {
  it('放行公网 http(s)', () => {
    expect(isPublicEndpoint('https://api.deepseek.com/v1/chat/completions')).toBe(true);
    expect(isPublicEndpoint('http://api.example.com:8080/chat')).toBe(true);
  });

  it('拒绝非 http(s)', () => {
    expect(isPublicEndpoint('ftp://example.com')).toBe(false);
    expect(isPublicEndpoint('file:///etc/passwd')).toBe(false);
    expect(isPublicEndpoint('not a url')).toBe(false);
  });

  it('拒绝环回/私网/链路本地', () => {
    expect(isPublicEndpoint('http://localhost:8000/v1')).toBe(false);
    expect(isPublicEndpoint('http://127.0.0.1:8000/v1')).toBe(false);
    expect(isPublicEndpoint('http://0.0.0.0/v1')).toBe(false);
    expect(isPublicEndpoint('http://10.1.2.3/v1')).toBe(false);
    expect(isPublicEndpoint('http://172.16.0.9/v1')).toBe(false);
    expect(isPublicEndpoint('http://172.31.255.1/v1')).toBe(false);
    expect(isPublicEndpoint('http://192.168.1.1/v1')).toBe(false);
    expect(isPublicEndpoint('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isPublicEndpoint('http://[::1]:9000/v1')).toBe(false);
    expect(isPublicEndpoint('http://my-service.localhost/v1')).toBe(false);
  });

  it('172.15/172.32 属公网（边界），172.20 属私网', () => {
    expect(isPublicEndpoint('http://172.15.9.9/v1')).toBe(true);
    expect(isPublicEndpoint('http://172.32.0.1/v1')).toBe(true);
    expect(isPublicEndpoint('http://172.20.0.1/v1')).toBe(false);
  });
});
