'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  RateLimitError,
  type PgSession,
  type PlaygroundSessionBody,
} from '@/lib/api';
import { useLocale, useT, fill, mapApiError } from '@/lib/i18n';
import { PageHero, SiteFooter, SiteHeader } from '@/components/SiteChrome';
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
      <SiteHeader crumb="Playground" />

      <PageHero eyebrow={t.playground.mastheadLabel} title="Playground" subtitle={t.playground.mastheadSub} />

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 md:py-14">
        {(submitError || pollLost) && (
          <div className="mb-6 animate-pop-in rounded-xl border border-seal/30 bg-seal/5 px-4 py-3 font-mono text-sm text-seal">
            {submitError ? submitError : t.playground.sessionExpired}
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[26rem_minmax(0,1fr)] lg:gap-10">
          {/* 左：场景表单 */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <PlaygroundForm onSubmit={handleSubmit} submitting={submitting} />
          </div>

          {/* 右：实时事件流 + 终局评分卡 */}
          <section className="min-w-0">
            {session && <PlaygroundScorecard session={session} />}

            {session?.status === 'failed' && (
              <div className="mb-6 animate-pop-in rounded-2xl border border-seal/30 bg-seal/5 p-5">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-seal">
                  {t.playground.failedLabel}
                </p>
                <p className="mt-2 break-words text-sm leading-relaxed text-ink">
                  {session.error ?? t.playground.failedFallback}
                </p>
                <p className="mt-2 text-[13px] text-dim">{t.playground.failedHint}</p>
              </div>
            )}

            {session?.status === 'queued' && (
              <div className="mb-6 flex animate-pop-in items-start gap-3 rounded-2xl border border-line bg-surface p-5">
                <span className="mt-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-hairline border-t-ledger" />
                <div>
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-dim">
                    {t.playground.queuedLabel}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink">
                    {fill(t.playground.queuedLine, { n: session.queuePosition ?? 1 })}
                  </p>
                </div>
              </div>
            )}

            <p className="eyebrow mb-4">{t.playground.streamSection}</p>
            <EventStream session={session} running={running} />
          </section>
        </div>
      </main>

      <SiteFooter tagline={t.footer.playground} />
    </div>
  );
}
