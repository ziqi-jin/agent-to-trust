'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  RateLimitError,
  type PgSession,
  type PlaygroundSessionBody,
} from '@/lib/api';
import { useLocale, useT, fill, mapApiError } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PlaygroundForm } from '@/components/playground/PlaygroundForm';
import { EventStream } from '@/components/playground/EventStream';
import { PlaygroundScorecard } from '@/components/playground/PlaygroundScorecard';

const POLL_MS = 1500;

export default function PlaygroundPage() {
  const t = useT();
  const { locale } = useLocale();
  const [submitting, setSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<PgSession | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pollLost, setPollLost] = useState(false);

  const handleSubmit = useCallback(
    (body: PlaygroundSessionBody) => {
      setSubmitError(null);
      setPollLost(false);
      setSession(null);
      setSessionId(null);
      setSubmitting(true);
      api
        .createPlaygroundSession({ ...body, locale })
        .then(({ id }) => setSessionId(id))
        .catch((e: unknown) => {
          const err = e as Error;
          if (err.name === 'RateLimitError') {
            setSubmitError(
              fill(t.apiError.rateLimitedSeconds, {
                seconds: (err as RateLimitError).retryAfterSeconds,
              }),
            );
          } else {
            setSubmitError(locale === 'zh' ? err.message : mapApiError(err.message, t.apiError));
          }
        })
        .finally(() => setSubmitting(false));
    },
    [locale, t],
  );

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
        // 终局（done/failed）才停轮询；queued → running 还要继续看
        if (s.status === 'done' || s.status === 'failed') setSessionId(null);
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

  const running =
    sessionId !== null || session?.status === 'running' || session?.status === 'queued';

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      {/* 报头：与名册同款账簿绿刊头 */}
      <header className="bg-ledger text-paper">
        <div className="mx-auto max-w-6xl px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-paper/70">
                {t.playground.mastheadLabel}
              </p>
              <h1 className="mt-1 font-display text-xl font-black uppercase tracking-[0.16em] md:text-2xl">
                Playground
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-paper/70">
                {t.playground.mastheadSub}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <a
                href="/"
                className="border border-paper/40 px-3 py-1.5 font-mono text-xs text-paper transition hover:border-paper hover:bg-paper/10"
              >
                {t.playground.back}
              </a>
            </div>
          </div>
        </div>
      </header>

      {(submitError || pollLost) && (
        <div className="mx-6 mt-4 border border-seal/50 bg-seal/10 px-4 py-2 font-mono text-sm text-seal">
          {submitError ? submitError : t.playground.sessionExpired}
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
                  {t.playground.failedLabel}
                </p>
                <p className="mt-2 break-words text-sm leading-relaxed text-ink">
                  {session.error ?? t.playground.failedFallback}
                </p>
                <p className="mt-2 text-[13px] text-dim">{t.playground.failedHint}</p>
              </div>
            )}

            {session?.status === 'queued' && (
              <div
                className="stamp-in mb-8 border-2 border-hairline bg-panel p-5"
                style={{ '--rot': '0.6deg', transform: 'rotate(0.6deg)' } as React.CSSProperties}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
                  {t.playground.queuedLabel}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink">
                  {fill(t.playground.queuedLine, { n: session.queuePosition ?? 1 })}
                </p>
              </div>
            )}

            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
              {t.playground.streamSection}
            </p>
            <EventStream session={session} running={running} />
          </section>
        </div>
      </main>

      {/* 页脚：双划线收底，与名册一致 */}
      <footer className="mt-auto border-t-[3px] border-double border-ink/70 px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-dim">{t.footer.playground}</p>
          <p className="font-mono text-xs text-dim">Don&apos;t trust an Agent. Test it.</p>
        </div>
      </footer>
    </div>
  );
}
