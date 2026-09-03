/**
 * Playground 内存会话存储（TDD）。
 * 红线：apiKey 绝不入 StoredSession——序列化后的会话对象里搜不到 key。
 */
import { describe, expect, it } from 'vitest';
import { PlaygroundStore } from '../store';
import { validateSessionInput } from '../scenario';

const validInput = validateSessionInput({
  name: 'my-agent',
  endpoint: 'https://api.example.com/chat',
  apiKey: 'sk-secret-do-not-store',
  scenario: { templateId: 'neg-keyboard-price' },
});
if (!validInput.ok) throw new Error('fixture 校验失败');

describe('PlaygroundStore', () => {
  it('create：生成 pg- 前缀 id、queued 起步（队列 dispatch 翻 running）、空事件流；apiKey 不入会话对象', () => {
    const store = new PlaygroundStore();
    const s = store.create(validInput.value);
    expect(s.id).toMatch(/^pg-/);
    expect(s.status).toBe('queued');
    expect(s.events).toEqual([]);
    expect(s.name).toBe('my-agent');
    expect(s.endpoint).toBe('https://api.example.com/chat');
    // 红线断言：整个会话对象序列化后搜不到 key
    expect(JSON.stringify(s)).not.toContain('sk-secret-do-not-store');
  });

  it('get：命中 / 未命中', () => {
    const store = new PlaygroundStore();
    const s = store.create(validInput.value);
    expect(store.get(s.id)?.id).toBe(s.id);
    expect(store.get('pg-nope')).toBeUndefined();
  });

  it('sweep：TTL 1h，过期清除、新鲜保留', () => {
    const store = new PlaygroundStore();
    const s1 = store.create(validInput.value);
    const t1 = s1.createdAt;
    const s2 = store.create(validInput.value);
    // 把 s1 的 createdAt 拨回 2 小时前
    s1.createdAt = t1 - 2 * 3600_000;
    store.sweep(t1);
    expect(store.get(s1.id)).toBeUndefined();
    expect(store.get(s2.id)?.id).toBe(s2.id);
  });

  it('runner 可就地追加事件与改状态（引用语义）', () => {
    const store = new PlaygroundStore();
    const s = store.create(validInput.value);
    s.events.push({ seq: 1, round: 0, actor: 'system', type: 'scenario', text: '开局' });
    s.status = 'done';
    expect(store.get(s.id)?.events).toHaveLength(1);
    expect(store.get(s.id)?.status).toBe('done');
  });
});
