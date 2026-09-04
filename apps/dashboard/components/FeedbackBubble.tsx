'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * 反馈入口（隐蔽但可发现）：右下角低透明度小气泡，hover 变亮。
 * 点开收集文字反馈 + 可选联系方式，POST /feedback（限速：同 IP 每分钟 3 条）。
 */
export function FeedbackBubble() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const text = message.trim();
    if (!text || status === 'sending') return;
    setStatus('sending');
    setError(null);
    try {
      await api.submitFeedback(text, contact.trim() || undefined, window.location.hash || '/');
      setStatus('sent');
      setMessage('');
      setContact('');
    } catch (e) {
      setError((e as Error).message);
      setStatus('idle');
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-72 border border-hairline bg-paper p-4 shadow-xl">
          {status === 'sent' ? (
            <div className="py-3 text-center">
              <p className="text-sm font-medium text-ink">{t.feedback.sent}</p>
              <button
                onClick={() => {
                  setOpen(false);
                  setStatus('idle');
                }}
                className="mt-3 border border-hairline px-3 py-1 font-mono text-xs text-dim transition hover:text-ink"
              >
                {t.feedback.close}
              </button>
            </div>
          ) : (
            <>
              <p className="mb-2 font-mono text-[11px] text-dim">{t.feedback.prompt}</p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t.feedback.placeholder}
                className="w-full resize-none border border-hairline bg-panel px-2.5 py-2 text-sm text-ink placeholder:text-dim/60 focus:border-ledger focus:outline-none"
              />
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={200}
                placeholder={t.feedback.contactPlaceholder}
                className="mt-2 w-full border border-hairline bg-panel px-2.5 py-1.5 text-xs text-ink placeholder:text-dim/60 focus:border-ledger focus:outline-none"
              />
              {error && <p className="mt-1.5 text-xs text-seal">{error}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="px-2.5 py-1 font-mono text-xs text-dim transition hover:text-ink"
                >
                  {t.feedback.cancel}
                </button>
                <button
                  onClick={submit}
                  disabled={status === 'sending' || !message.trim()}
                  className="bg-ledger px-3 py-1 font-mono text-xs font-medium text-paper transition hover:bg-[#9A3412] disabled:opacity-40"
                >
                  {status === 'sending' ? t.feedback.sending : t.feedback.send}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t.feedback.title}
        title={t.feedback.title}
        className="flex h-8 w-8 items-center justify-center border border-hairline bg-paper/80 text-dim/70 opacity-50 transition-all hover:border-ledger hover:text-ledger hover:opacity-100"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    </div>
  );
}
