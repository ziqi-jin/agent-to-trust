/**
 * 抽签 + 参数抖动：seed 确定性（可复现），但对用户不可预测（sessionId 由服务端生成）。
 * 均权抽签（防「总抽到好打的」）；参数在区间内抖动（防背固定数字）。
 */
import { createHash } from 'node:crypto';
import { LIVE_PERSONAS, PERSONAS, type Persona } from './personas';

/** 稳定哈希 → [0,1)。 */
function hashUnit(seed: string, salt: string): number {
  const h = createHash('sha256').update(`${salt}:${seed}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

export function seedFromSession(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}

export function pickPersona(opts: { mode: 'live' | 'scripted'; seed: string }): Persona {
  if (opts.mode === 'scripted') return PERSONAS.find((p) => p.id === 'scripted')!;
  const idx = Math.floor(hashUnit(opts.seed, 'persona') * LIVE_PERSONAS.length);
  return LIVE_PERSONAS[Math.min(idx, LIVE_PERSONAS.length - 1)];
}

export function jitterParams(persona: Persona, seed: string): { opening: number; floor: number } {
  const span = (range: [number, number], salt: string): number => {
    const [lo, hi] = range;
    return Math.round(lo + hashUnit(seed, salt) * (hi - lo));
  };
  const opening = span(persona.strategy.opening, 'opening');
  let floor = span(persona.strategy.floor, 'floor');
  if (floor >= opening) floor = opening - 1; // 防御：区间接壤人格
  return { opening, floor };
}
