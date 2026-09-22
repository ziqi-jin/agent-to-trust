import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(import.meta.dirname, '..', '..', '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('reverse-dependency lock', () => {
  it('core/scoring/sdk/adapters 与 apps/* 不得 import @a2t/jev', () => {
    const targets = [
      join(REPO, 'packages', 'core'),
      join(REPO, 'packages', 'scoring'),
      join(REPO, 'packages', 'sdk'),
      join(REPO, 'packages', 'adapters'),
      join(REPO, 'apps'),
    ];
    // 只查真正的 import（不是文档/字符串里出现包名）。
    const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@a2t\/jev['"]/;
    const offenders: string[] = [];
    for (const t of targets) {
      for (const f of walk(t)) {
        if (IMPORT_RE.test(readFileSync(f, 'utf8'))) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
