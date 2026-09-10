import { buildApp } from './app';
import { createDb } from './db/client';
import { migrate } from './db/migrate';
import { sweepStaleSessions } from './services/arenaSweep';

const url = process.env.DATABASE_URL ?? 'postgres://acl:acl@localhost:5432/acl';
const port = Number(process.env.PORT ?? 8000);

await migrate(url);
const db = createDb(url);
const app = buildApp(db);

await app.listen({ host: '0.0.0.0', port });
console.log(`Agent Credit Lab API listening on :${port}`);

// Arena 悬空会话兜底清扫：默认 5 分钟一轮（ARENA_SWEEP_DISABLED=1 关闭；TTL 见 ARENA_SESSION_TTL_MINUTES）
if (process.env.ARENA_SWEEP_DISABLED !== '1') {
  const sweepIntervalMs = Number(process.env.ARENA_SWEEP_INTERVAL_MS ?? 300_000);
  const timer = setInterval(() => {
    sweepStaleSessions(app).catch((e) => console.error('[arena-sweep] failed:', e));
  }, sweepIntervalMs);
  timer.unref();
}
