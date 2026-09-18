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
        <div className="w-80 max-w-[calc(100vw-2.5rem)] origin-bottom-right animate-pop-in rounded-2xl border border-hairline bg-surface p-4 shadow-lift">
          {status === 'sent' ? (
            <div className="py-3 text-center">
              <p className="text-sm font-medium text-ink">{t.feedback.sent}</p>
              <button
                onClick={() => {
                  setOpen(false);
                  setStatus('idle');
                }}
                className="btn-secondary mt-3 px-3 py-1.5 font-mono text-xs"
              >
                {t.feedback.close}
              </button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-[13px] font-medium text-ink">{t.feedback.prompt}</p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t.feedback.placeholder}
                className="input mt-0 resize-none"
              />
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={200}
                placeholder={t.feedback.contactPlaceholder}
                className="input mt-2 py-2 text-xs"
              />
              {error && <p className="mt-1.5 text-xs text-seal">{error}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="btn-ghost px-3 py-1.5 font-mono text-xs"
                >
                  {t.feedback.cancel}
                </button>
                <button
                  onClick={submit}
                  disabled={status === 'sending' || !message.trim()}
                  className="btn-primary px-4 py-1.5 font-mono text-xs shadow-none"
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
        aria-expanded={open}
        className={`flex h-10 w-10 items-center justify-center rounded-full border bg-surface shadow-card transition-all duration-300 hover:scale-110 hover:border-ledger hover:text-ledger hover:opacity-100 ${
          open ? 'border-ledger text-ledger opacity-100' : 'border-hairline text-dim opacity-60'
        }`}
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
