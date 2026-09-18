'use client';

/**
 * 轻量动效原语（零依赖）：
 * - <Reveal>：进入视口时淡入上移（IntersectionObserver，只触发一次）；
 * - <CountUp>：进入视口时数字从 0 滚到目标值（rAF + easeOutCubic）。
 * 两者都尊重 prefers-reduced-motion（CSS 侧直接呈现 / JS 侧直接给终值）。
 */
import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

function useInView<T extends Element>(rootMargin = '0px 0px -8% 0px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return { ref, inView };
}

export function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: ElementType;
}) {
  const { ref, inView } = useInView<HTMLElement>();
  return (
    <Tag
      ref={ref}
      data-shown={inView}
      className={`reveal ${className}`}
      style={{ '--reveal-delay': `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function CountUp({
  value,
  duration = 1400,
  className = '',
}: {
  value: number | null | undefined;
  duration?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (value == null || !inView) return;
    if (prefersReducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(origin + (value - origin) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, inView, duration]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {value == null ? '—' : shown.toLocaleString('en-US')}
    </span>
  );
}

const GLYPHS = '01ABCDEF#%&*<>/\\=+';

/**
 * <Scramble>：进入视口时文字从乱码逐位「解码」成原文（等宽短标签用）。
 * SSR 首帧直接输出原文，客户端进入视口才播放；reduced-motion 下不播放。
 */
export function Scramble({ text, className = '', duration = 900 }: { text: string; className?: string; duration?: number }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [out, setOut] = useState(text);

  useEffect(() => {
    if (!inView || prefersReducedMotion()) {
      setOut(text);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const settled = Math.floor(p * text.length);
      let s = '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        s += i < settled || ch === ' ' ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      setOut(s);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, text, duration]);

  return (
    <span ref={ref} className={className} aria-label={text}>
      <span aria-hidden>{out}</span>
    </span>
  );
}
