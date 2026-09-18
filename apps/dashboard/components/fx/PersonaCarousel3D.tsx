'use client';

/**
 * PersonaCarousel3D — 「理论背书」：四个对手人格排成一圈 3D 转盘。
 * - 每个人格有自己固定的 Agent 形象（外形 / 眼神 / 强调色表达立场：强硬=红、温和=绿、诱导=琥珀、脚本基线=灰）；
 * - 自动轮转，悬停暂停；可点选、可拖拽旋转（松手吸附到最近一张）；
 * - 右侧面板给出「你的 Agent ⟷ 该人格」对局示意 + 理论锚 + 出处，文字清晰可读。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Anchor, BookOpen } from 'lucide-react';
import { COUNTERPART_THEORY, type CounterpartTheoryKey } from '@a2t/core';
import { useLocale, useT } from '@/lib/i18n';
import { AgentMark, type AgentVariant } from './AgentMark';
import { centered, prefersReduced } from './stage';

export const PERSONA_ROWS: CounterpartTheoryKey[] = ['llm-stubborn', 'llm-softer', 'llm-lure', 'scripted'];

export const PERSONA_LOOK: Record<CounterpartTheoryKey, AgentVariant> = {
  'llm-stubborn': { shape: 1, eyes: 1, antenna: 2, accent: '#F2574D' },
  'llm-softer': { shape: 0, eyes: 3, antenna: 3, accent: '#3DD68C' },
  'llm-lure': { shape: 0, eyes: 2, antenna: 1, accent: '#F5A524' },
  scripted: { shape: 1, eyes: 0, antenna: 0, accent: '#A1A1AA' },
};

const CARD_W = 240;
const CARD_H = 330;
const RADIUS = 330;
const ARC = 38; // 相邻卡片的夹角（cover-flow 弧形排布，邻卡斜着露出来）
const DRAG_PX = 170; // 拖动多少像素 = 一张

export function PersonaCarousel3D() {
  const t = useT();
  const { locale } = useLocale();
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const dragStart = useRef<{ x: number; base: number } | null>(null);
  const moved = useRef(false);
  const prevRel = useRef<number[]>([]); // 上一帧各卡的位置：从隐藏位绕回来的卡只淡入、不横扫
  const n = PERSONA_ROWS.length;

  // 自动轮转（悬停 / 拖拽 / reduced-motion 时停）
  useEffect(() => {
    if (hover || drag !== null || prefersReduced()) return;
    const id = window.setTimeout(() => setIdx((i) => i + 1), 4800);
    return () => window.clearTimeout(id);
  }, [idx, hover, drag]);

  const cur = ((idx % n) + n) % n;
  const key = PERSONA_ROWS[cur];
  const entry = COUNTERPART_THEORY[key];
  const look = PERSONA_LOOK[key];
  const offset = drag ?? 0; // 拖拽中的小数偏移（单位：张）
  const rels = PERSONA_ROWS.map((_, i) => {
    let base = (((i - cur) % n) + n) % n;
    if (base >= n / 2) base -= n;
    return base + offset;
  });
  useEffect(() => {
    prevRel.current = rels;
  });

  /** 走最短方向转到第 i 张。 */
  const goTo = (i: number) => {
    let d = (((i - cur) % n) + n) % n;
    if (d > n / 2) d -= n;
    setIdx(idx + d);
  };

  const onDown = (e: React.PointerEvent) => {
    dragStart.current = { x: e.clientX, base: 0 };
    moved.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    if (Math.abs(dx) > 6) moved.current = true;
    if (moved.current) setDrag(Math.max(-1.5, Math.min(1.5, dx / DRAG_PX)));
  };
  const onUp = () => {
    if (drag !== null) setIdx(idx - Math.round(drag));
    dragStart.current = null;
    setDrag(null);
  };

  return (
    <div
      className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {/* 转盘 */}
      <div
        className="relative h-[420px] cursor-grab touch-pan-y select-none overflow-hidden active:cursor-grabbing"
        style={{ perspective: 1100 }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* 地面光圈 */}
        <div
          aria-hidden
          className="absolute left-1/2 top-[78%] h-[120px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-line-strong"
          style={{ background: `radial-gradient(ellipse, ${look.accent}33, transparent 70%)`, transition: 'background 0.8s' }}
        />
        <div className="p3d absolute inset-0" style={{ transform: `translateY(-8px) rotateX(-6deg) translateZ(${-RADIUS}px)` }}>
          {PERSONA_ROWS.map((k, i) => {
            const e = COUNTERPART_THEORY[k];
            const v = PERSONA_LOOK[k];
            // 相对当前卡的最短偏移（-2..1），加上拖拽小数偏移
            const rel = rels[i];
            const hidden = Math.abs(rel) > 1.6;
            const wasHidden = Math.abs(prevRel.current[i] ?? rel) > 1.6;
            const front = Math.abs(rel) < 0.5;
            return (
              <button
                key={k}
                type="button"
                onClick={() => !moved.current && goTo(i)}
                title={`${e.label[locale]} · ${e.anchor[locale]}`}
                className={`absolute flex flex-col overflow-hidden rounded-lg border bg-surface p-5 text-left ${
                  front ? 'hud border-transparent shadow-lift' : 'border-line-strong'
                }`}
                style={{
                  ...centered(CARD_W, CARD_H),
                  transform: `rotateY(${rel * ARC}deg) translateZ(${RADIUS}px)`,
                  backfaceVisibility: 'hidden',
                  opacity: hidden ? 0 : 1 - Math.min(1, Math.abs(rel)) * 0.55,
                  pointerEvents: hidden ? 'none' : undefined,
                  zIndex: 10 - Math.round(Math.abs(rel) * 3),
                  transition:
                    drag !== null
                      ? 'opacity .3s'
                      : wasHidden
                        ? 'opacity .45s ease .25s'
                        : 'transform 0.9s cubic-bezier(0.16,1,0.3,1), opacity .5s, box-shadow .5s, border-color .5s',
                  boxShadow: front ? `0 0 0 1px ${v.accent}88, 0 20px 60px -20px ${v.accent}66` : undefined,
                }}
              >
                <span className="flex items-center justify-between font-mono text-[11px] text-dim">
                  <span>{k === 'scripted' ? 'BASELINE' : `PERSONA ${String(i + 1).padStart(2, '0')}`}</span>
                  <span className="h-2 w-2 rounded-full" style={{ background: v.accent, boxShadow: `0 0 10px ${v.accent}` }} />
                </span>
                <span className="relative mx-auto mt-3 grid h-28 w-28 shrink-0 place-items-center">
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full"
                    style={{ background: `radial-gradient(circle, ${v.accent}30, transparent 68%)` }}
                  />
                  <span aria-hidden className="absolute inset-3 animate-spin-b rounded-full border border-dashed" style={{ borderColor: `${v.accent}55` }} />
                  <AgentMark seed={k} variant={v} size={76} />
                </span>
                <span className="mt-3 line-clamp-2 font-display text-lg font-semibold leading-snug text-ink">{e.label[locale]}</span>
                {/* 卡面只露 3 行理论锚（全文在右侧面板）；line-clamp 不能与 display:block 共用 */}
                <span className="mt-1.5 line-clamp-3 font-mono text-[11.5px] leading-[1.55]" style={{ color: v.accent }}>
                  {e.anchor[locale]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 说明面板 */}
      <div className="hud relative rounded-lg border border-line bg-surface p-6">
        {/* 对局示意：你的 Agent ⟷ 当前人格 */}
        <div className="flex items-center gap-3 rounded-md border border-line bg-night px-4 py-3">
          <span className="flex flex-col items-center gap-1">
            <AgentMark seed="your-agent" size={40} variant={{ accent: '#FF6A1F' }} />
            <span className="font-mono text-[11px] uppercase tracking-wider text-dim">{t.fx.yourAgent}</span>
          </span>
          <svg className="h-6 w-full min-w-0 flex-1" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
            <line x1="0" y1="12" x2="100" y2="12" stroke="#3A3A42" strokeWidth="2" />
            <line className="animate-dash" x1="0" y1="12" x2="100" y2="12" stroke={look.accent} strokeWidth="2" strokeDasharray="6 6" />
          </svg>
          <span className="rounded-[3px] border border-line-strong px-1.5 py-0.5 font-mono text-[11px] uppercase text-dim">{t.fx.vs}</span>
          <svg className="h-6 w-full min-w-0 flex-1" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
            <line x1="0" y1="12" x2="100" y2="12" stroke="#3A3A42" strokeWidth="2" />
            <line className="animate-dash" x1="100" y1="12" x2="0" y2="12" stroke={look.accent} strokeWidth="2" strokeDasharray="6 6" />
          </svg>
          <span className="flex flex-col items-center gap-1">
            <AgentMark key={key} seed={key} variant={look} size={40} className="animate-pop-in" />
            <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: look.accent }}>
              {key === 'scripted' ? 'baseline' : `persona ${cur + 1}`}
            </span>
          </span>
        </div>

        <div key={key} className="animate-fade-up">
          <h3 className="mt-6 font-display text-2xl font-semibold leading-snug text-ink">{entry.label[locale]}</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-dim">{entry.blurb[locale]}</p>
          <div className="mt-5 space-y-2 border-t border-dashed border-line-strong pt-4">
            <p className="flex gap-2 font-mono text-[12px] leading-relaxed" style={{ color: look.accent }}>
              <Anchor size={13} className="mt-[3px] shrink-0" />
              <span>
                {t.theory.anchorLabel} · {entry.anchor[locale]}
              </span>
            </p>
            <p className="flex gap-2 font-mono text-[11px] leading-relaxed text-dim">
              <BookOpen size={13} className="mt-[2px] shrink-0" />
              <span>
                {t.theory.sourceLabel} · {entry.source}
              </span>
            </p>
          </div>
        </div>

        {/* 切换 */}
        <div className="mt-6 flex items-center gap-2">
          <button type="button" onClick={() => setIdx(idx - 1)} aria-label={t.fx.prev} className="btn-secondary h-8 w-8 p-0">
            <ChevronLeft size={16} />
          </button>
          <div className="flex flex-1 gap-1.5">
            {PERSONA_ROWS.map((k, i) => (
              <button
                key={k}
                type="button"
                aria-label={COUNTERPART_THEORY[k].label[locale]}
                aria-pressed={i === cur}
                onClick={() => goTo(i)}
                className="group/dot flex h-8 flex-1 items-center"
              >
                <span
                  className="h-1.5 w-full rounded-full transition-all duration-300 group-hover/dot:opacity-80"
                  style={{ background: i === cur ? PERSONA_LOOK[k].accent : '#2E2E35' }}
                />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setIdx(idx + 1)} aria-label={t.fx.next} className="btn-secondary h-8 w-8 p-0">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
