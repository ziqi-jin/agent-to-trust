import { describe, expect, it } from 'vitest';
import { SOURCE_WEIGHTS } from '../index';

// Bug 背景：ingest 落库一直写 source='real-benchmark'，但 SOURCE_WEIGHTS 没有这个键，
// scoring 的 sourceWeight() 走 `?? 0.3` 兜底 → 榜单1 真实签名证据长期按 0.3 低权重计分。
describe('SOURCE_WEIGHTS', () => {
  it('real-benchmark（考场 ingest 真实签名证据）按 1.0 计权', () => {
    expect(SOURCE_WEIGHTS['real-benchmark']).toBe(1.0);
  });
});
