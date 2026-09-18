'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useT } from '@/lib/i18n';

/**
 * 一键复制按钮（0915 老大指令：凡展示命令 / 脚本、用户要粘走的地方都配一个）。
 *
 * 点击把 text 写入剪贴板，1.5s 内显示「已复制」。放在代码块外层容器的右上角
 * （absolute），因此不会随代码块横向滚动而移出视口。
 */
export function CopyButton({
  text,
  className = '',
  dark = false,
}: {
  text: string;
  className?: string;
  /** 放在深色代码窗上时用反白样式。 */
  dark?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!(await writeClipboard(text))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const label = copied ? t.common.copied : t.common.copy;

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 py-1.5 font-mono text-[11px] leading-none transition-all duration-200 active:scale-95 ${
        dark
          ? 'border-line-strong bg-surface/80 text-dim hover:border-ledger/60 hover:text-ink'
          : 'border-line-strong bg-panel text-dim hover:border-ledger/60 hover:text-ink'
      } ${copied ? '!border-info/50 !text-info' : ''} ${className}`}
    >
      {copied ? (
        <Check className="h-3 w-3 animate-pop-in" strokeWidth={2.5} />
      ) : (
        <Copy className="h-3 w-3" strokeWidth={2} />
      )}
      <span>{label}</span>
    </button>
  );
}

/** 写剪贴板：优先 async Clipboard API（localhost / https 安全上下文），退化到 execCommand。 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 退化到 execCommand 路径 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
