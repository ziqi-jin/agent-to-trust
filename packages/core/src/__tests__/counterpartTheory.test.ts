import { describe, expect, it } from 'vitest';
import { COUNTERPART_THEORY } from '../counterpartTheory';

describe('COUNTERPART_THEORY', () => {
  it('覆盖四个人格键', () => {
    expect(Object.keys(COUNTERPART_THEORY).sort()).toEqual(
      ['llm-lure', 'llm-softer', 'llm-stubborn', 'scripted'].sort(),
    );
  });
  it('每项双语字段非空且含真实出处', () => {
    for (const [k, v] of Object.entries(COUNTERPART_THEORY)) {
      expect(v.label.zh, `${k}.label.zh`).toBeTruthy();
      expect(v.label.en, `${k}.label.en`).toBeTruthy();
      expect(v.anchor.zh).toBeTruthy();
      expect(v.quote.en).toBeTruthy();
      expect(v.source, `${k}.source`).toMatch(/Axelrod|Nash|Schelling|Pruitt|Cialdini|Aristotle|马基雅维利|Machiavelli/);
    }
  });
  it('诱导型锚 Cialdini，强硬型锚 Schelling，配合型锚 Pruitt', () => {
    expect(COUNTERPART_THEORY['llm-lure'].source).toContain('Cialdini');
    expect(COUNTERPART_THEORY['llm-stubborn'].source).toContain('Schelling');
    expect(COUNTERPART_THEORY['llm-softer'].source).toContain('Pruitt');
  });
});
