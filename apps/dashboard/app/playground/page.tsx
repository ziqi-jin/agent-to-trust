'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type PgSession,
  type PlaygroundSessionBody,
} from '@/lib/api';
import { PlaygroundForm } from '@/components/playground/PlaygroundForm';
import { EventStream } from '@/components/playground/EventStream';
import { PlaygroundScorecard } from '@/components/playground/PlaygroundScorecard';

const POLL_MS = 1500;

export default function PlaygroundPage() {
  const [submitting, setSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<PgSession | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pollLost, setPollLost] = useState(false);

  const handleSubmit = useCallback((body: PlaygroundSessionBody) => {
    setSubmitError(null);
    setPollLost(false);
    setSession(null);
    setSessionId(null);
    setSubmitting(true);
    api
      .createPlaygroundSession(body)
      .then(({ id }) => setSessionId(id))
      .catch((e: unknown) => setSubmitError((e as Error).message))
      .finally(() => setSubmitting(false));
  }, []);

  // 开跑后每 1.5s 轮询；404（TTL 过期/不存在）停止并提示；done/failed 停止。
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    let inFlight = false;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const s = await api.getPlaygroundSession(sessionId);
        if (!alive) return;
        if (s === null) {
          setPollLost(true);
          setSessionId(null); // 停轮询，保留最后一次事件流
          return;
        }
        setSession(s);
        if (s.status !== 'running') setSessionId(null); // 终局，停轮询
      } catch {
        // 单次网络抖动不打断轮询，下一轮重试
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId]);

  const running = sessionId !== null || session?.status === 'running';

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      {/* 报头：与名册同款账簿绿刊头 */}
      <header className="bg-ledger text-paper">
        <div className="mx-auto max-w-6xl px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-paper/70">
                Agent Credit Lab · 自测场
              </p>
              <h1 className="mt-1 font-display text-xl font-black uppercase tracking-[0.16em] md:text-2xl">
                Playground
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-paper/70">
                零安装自测场 · 填 endpoint，跑一局，拿评分卡 · 不进官方榜
              </p>
            </div>
            <a
              href="/"
              className="border border-paper/40 px-3 py-1.5 font-mono text-xs text-paper transition hover:border-paper hover:bg-paper/10"
            >
              ← 公开名册
            </a>
          </div>
        </div>
      </header>

      {(submitError || pollLost) && (
        <div className="mx-6 mt-4 border border-seal/50 bg-seal/10 px-4 py-2 font-mono text-sm text-seal">
          {submitError
            ? submitError
            : '会话不存在或已过期（自测场会话 1 小时后清除）——重新填好表单，再跑一局。'}
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="grid gap-12 lg:grid-cols-[26rem_1fr] lg:gap-10">
          {/* 左：场景表单 */}
          <PlaygroundForm onSubmit={handleSubmit} submitting={submitting} />

          {/* 右：实时事件流 + 终局评分卡 */}
          <section>
            {session && <PlaygroundScorecard session={session} />}

            {session?.status === 'failed' && (
              <div
                className="stamp-in mb-8 border-2 border-seal/60 bg-paper p-5"
                style={{ '--rot': '1deg', transform: 'rotate(1deg)' } as React.CSSProperties}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-seal">
                  会话失败 · SESSION FAILED
                </p>
                <p className="mt-2 break-words text-sm leading-relaxed text-ink">
                  {session.error ?? '连续两次调用 endpoint 失败。'}
                </p>
                <p className="mt-2 text-[13px] text-dim">
                  检查 endpoint 是否公网可达（http(s) 地址）、key 是否有效，再试一局。
                </p>
              </div>
            )}

            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
              §PG-3 — 实时证据流 LIVE EVIDENCE
            </p>
            <EventStream session={session} running={running} />
          </section>
        </div>
      </main>

      {/* 页脚：双划线收底，与名册一致 */}
      <footer className="mt-auto border-t-[3px] border-double border-ink/70 px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-dim">
            AGENT CREDIT LAB · PLAYGROUND · 分数皆可反查证据
          </p>
          <p className="font-mono text-xs text-dim">Don&apos;t trust an Agent. Test it.</p>
        </div>
      </footer>
    </div>
  );
}
