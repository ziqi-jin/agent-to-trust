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
export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
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
      className={`inline-flex items-center gap-1 border border-hairline bg-paper px-1.5 py-1 font-mono text-[10px] leading-none text-dim transition hover:border-ink hover:text-ink ${className}`}
    >
      {copied ? (
        <Check className="h-3 w-3 text-ledger" strokeWidth={2.5} />
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
