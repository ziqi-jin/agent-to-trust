import { describe, expect, it } from 'vitest';
import { loadSuite } from 'agent-to-trust';
import { FIXTURES } from '../src/samples/fixtures.js';
import { buildSamples } from '../src/samples/builder.js';

describe('R3 samples', () => {
  const suiteIds = new Set(loadSuite().map((c) => c.id));

  it('每个 fixture caseId 都在 suite 里', () => {
    for (const id of Object.keys(FIXTURES)) expect(suiteIds.has(id)).toBe(true);
  });

  it('buildSamples 展开为 (caseId,label,output,dimension)', () => {
    const samples = buildSamples();
    expect(samples.length).toBeGreaterThan(20);
    for (const s of samples) {
      expect(['success', 'partial', 'failure']).toContain(s.label);
      expect(typeof s.output).toBe('string');
      expect(s.output.length).toBeGreaterThan(0);
      expect(s.dimension).toBeDefined();
    }
  });

  it('tricky 样本被计为 failure(对抗样本落 failure 桶)', () => {
    const samples = buildSamples();
    const trickyCount = Object.values(FIXTURES).reduce(
      (n, outs) => n + (typeof outs.tricky === 'string' ? 1 : 0),
      0,
    );
    const failures = samples.filter((s) => s.label === 'failure').length;
    expect(trickyCount).toBeGreaterThan(0);
    expect(failures).toBeGreaterThanOrEqual(trickyCount);
  });
});
