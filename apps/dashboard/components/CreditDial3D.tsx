'use client';

/**
 * CreditDial3D — 首屏签名元素：3D 信用表盘。
 *
 * 结构（由远到近，各层处在不同 Z 深度）：
 *   基座辉光 → 刻度外环 → 虚线环 + 发光弧段 → 雷达扫描 → 环形字 → 有厚度的印章硬币（分数滚动计数）
 * 整台表盘持续缓慢倾摆，并叠加鼠标视差——各层因 Z 深度不同而明显分离，形成立体纵深。
 * 证据卡沿一条倾斜轨道公转，转到前方会遮住表盘，转到后方被表盘遮住（真实 3D 深度排序）。
 *
 * 实现：React + 纯 CSS 3D（preserve-3d / perspective）。环的自转走 CSS 动画（合成层），
 * 倾摆与轨道由 rAF 直接写 style（每帧不触发 React 重渲染）；离开视口 / 标签页隐藏时暂停；
 * prefers-reduced-motion 下保持静态姿态。零第三方依赖。数值与哈希为样例，下方注明 sample。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { CountUp } from './motion';

type Chip = { dim: string; mark: string; tone: string; hash: string };

const CHIPS: Chip[] = [
  { dim: 'capability', mark: '✓', tone: 'text-info', hash: '9f2c' },
  { dim: 'delivery', mark: '✓', tone: 'text-info', hash: '41be' },
  { dim: 'negotiation', mark: '◐', tone: 'text-amber', hash: 'c07d' },
  { dim: 'integrity', mark: '✓', tone: 'text-info', hash: '5a19' },
  { dim: 'reliability', mark: '✗', tone: 'text-seal', hash: 'e2f8' },
];

const ORBIT_TILT = (74 * Math.PI) / 180; // 轨道面倾角

const r2 = (v: number) => Math.round(v * 100) / 100; // SSR/CSR 浮点一致

/** 一层：固定在某个 Z 深度；内部再包一层做入场动画与自转。 */
function Layer({
  z,
  size,
  delay,
  spin,
  children,
}: {
  z: number;
  size: number;
  delay: number;
  spin?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden
      className="absolute left-1/2 top-1/2"
      style={{ width: size, height: size, transform: `translate(-50%,-50%) translateZ(${z}px)` }}
    >
      <div className="h-full w-full animate-dial-in" style={{ animationDelay: `${delay}ms` }}>
        <div className={`h-full w-full ${spin ?? ''}`}>{children}</div>
      </div>
    </div>
  );
}

function Ticks({ d, count, long, color }: { d: number; count: number; long: number; color: string }) {
  const r = d / 2;
  return (
    <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`}>
      <circle cx={r} cy={r} r={r - 1} fill="none" stroke="rgba(242,242,243,0.16)" />
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        const isLong = i % long === 0;
        const r1 = r - (isLong ? 14 : 7);
        return (
          <line
            key={i}
            x1={r2(r + Math.cos(a) * r1)}
            y1={r2(r + Math.sin(a) * r1)}
            x2={r2(r + Math.cos(a) * (r - 2))}
            y2={r2(r + Math.sin(a) * (r - 2))}
            stroke={isLong ? color : 'rgba(242,242,243,0.3)'}
            strokeWidth={isLong ? 2 : 1}
          />
        );
      })}
    </svg>
  );
}

/** 发光弧段：用 dasharray 画出三段不等长的弧。 */
function Arcs({ d }: { d: number }) {
  const r = d / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`} style={{ filter: 'drop-shadow(0 0 6px rgba(255,106,31,0.8))' }}>
      <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke="rgba(255,106,31,0.35)" strokeDasharray="2 6" />
      <circle
        cx={d / 2}
        cy={d / 2}
        r={r}
        fill="none"
        stroke="#FF6A1F"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${r2(c * 0.16)} ${r2(c * 0.09)} ${r2(c * 0.06)} ${r2(c * 0.21)} ${r2(c * 0.11)} ${r2(c * 0.37)}`}
      />
    </svg>
  );
}

function TextRing({ d, id }: { d: number; id: string }) {
  const r = d / 2 - 12;
  const c = d / 2;
  return (
    <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`}>
      <defs>
        <path id={id} d={`M${c},${c} m-${r},0 a${r},${r} 0 1,1 ${r * 2},0 a${r},${r} 0 1,1 -${r * 2},0`} />
      </defs>
      <circle cx={c} cy={c} r={c - 1} fill="none" stroke="rgba(255,106,31,0.45)" />
      <circle cx={c} cy={c} r={c - 24} fill="none" stroke="rgba(242,242,243,0.12)" />
      <text fill="rgba(242,242,243,0.7)" fontSize={Math.max(9, d * 0.034)} letterSpacing="3.5" fontFamily="var(--font-plex-mono), monospace">
        <textPath href={`#${id}`}>A2T · PUBLIC REGISTER OF AGENT CREDIT · EVERY SCORE TRACES BACK TO EVIDENCE ·</textPath>
      </text>
    </svg>
  );
}

export function CreditDial3D({ className = '' }: { className?: string }) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [size, setSize] = useState(520);

  // 尺寸随容器宽度自适应
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) =>
      setSize(Math.round(Math.max(300, Math.min(600, entry.contentRect.width)))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const scene = sceneRef.current;
    if (!stage || !scene) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const R = size * (size < 460 ? 0.34 : 0.46); // 轨道半径；小屏收紧，卡片不被屏幕边缘切掉
    const k = Math.max(0.72, Math.min(1, size / 520)); // 小屏上卡片等比缩小
    let mx = 0;
    let my = 0;
    let tmx = 0;
    let tmy = 0;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    let clock = 0;

    const render = (time: number) => {
      mx += (tmx - mx) * 0.05;
      my += (tmy - my) * 0.05;
      // 自发倾摆（李萨如轨迹）+ 鼠标视差
      const ax = Math.sin(time * 0.45) * 12 + my;
      const ay = Math.sin(time * 0.31 + 1) * 20 + mx;
      scene.style.transform = `rotateX(${ax.toFixed(2)}deg) rotateY(${ay.toFixed(2)}deg)`;

      const n = CHIPS.length;
      chipRefs.current.forEach((el, i) => {
        if (!el) return;
        const a = (i / n) * Math.PI * 2 + time * 0.28;
        const x = Math.cos(a) * R;
        const y = Math.sin(a) * R * Math.cos(ORBIT_TILT) - size * 0.02;
        const z = Math.sin(a) * R * Math.sin(ORBIT_TILT) + 40;
        const depth = (Math.sin(a) + 1) / 2;
        // 卡片始终正对观众：抵消场景倾摆
        el.style.transform = `translate(-50%,-50%) translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,${z.toFixed(1)}px) rotateY(${(-ay).toFixed(2)}deg) rotateX(${(-ax).toFixed(2)}deg) scale(${((0.8 + depth * 0.3) * k).toFixed(3)})`;
        el.style.opacity = (0.3 + depth * 0.7).toFixed(2);
      });
    };

    const frame = (now: number) => {
      clock += Math.min(64, now - last) / 1000;
      last = now;
      render(clock);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (reduced || raf || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    render(2.2); // 首帧 / reduced-motion 的静态姿态

    const onMove = (e: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      tmx = ((e.clientX - rect.left) / rect.width - 0.5) * 26;
      tmy = -((e.clientY - rect.top) / rect.height - 0.5) * 18;
    };
    const onLeave = () => {
      tmx = 0;
      tmy = 0;
    };
    const onVis = () => (document.hidden ? stop() : start());
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) start();
            else stop();
          })
        : null;
    io?.observe(stage);
    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVis);
    start();
    return () => {
      stop();
      io?.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [size]);

  const D = size * 0.9; // 表盘直径
  const coin = Math.round(D * 0.46);
  const px = (f: number) => Math.round(D * f);

  return (
    <div className={className}>
      <div
        ref={stageRef}
        className="relative mx-auto w-full max-w-[600px] select-none"
        style={{ height: Math.round(size * 0.95), perspective: 1300 }}
      >
        <div
          ref={sceneRef}
          className="absolute inset-0"
          style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}
        >
          {/* z -90 基座：辉光 + 点阵圆盘 */}
          <Layer z={-90} size={px(1.08)} delay={0}>
            <div className="h-full w-full rounded-full bg-[radial-gradient(circle,rgba(255,106,31,0.28)_0%,rgba(255,106,31,0.06)_45%,transparent_70%)]" />
          </Layer>
          <Layer z={-70} size={px(0.98)} delay={80}>
            <div className="bg-dots h-full w-full rounded-full opacity-70 [mask-image:radial-gradient(circle,#000_55%,transparent_71%)]" />
          </Layer>

          {/* z -45 刻度外环（慢转） */}
          <Layer z={-45} size={px(1)} delay={160} spin="animate-spin-a">
            <Ticks d={px(1)} count={120} long={10} color="rgba(255,106,31,0.9)" />
          </Layer>

          {/* z -15 发光弧段（快转） */}
          <Layer z={-15} size={px(0.86)} delay={260} spin="animate-spin-c">
            <Arcs d={px(0.86)} />
          </Layer>

          {/* z 5 雷达扫描 */}
          <Layer z={5} size={px(0.78)} delay={360} spin="animate-sweep">
            <div className="h-full w-full rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,transparent_290deg,rgba(255,106,31,0.38)_360deg)] [mask-image:radial-gradient(circle,transparent_38%,#000_40%,#000_70%,transparent_71%)]" />
          </Layer>

          {/* z 25 环形字（反向转） */}
          <Layer z={25} size={px(0.72)} delay={460} spin="animate-spin-d">
            <TextRing d={px(0.72)} id={`dial-text-${px(0.72)}`} />
          </Layer>

          {/* z 55–70 印章硬币：叠层做出厚度，正面是分数 */}
          <div
            className="absolute left-1/2 top-1/2"
            style={{ width: coin, height: coin, transform: 'translate(-50%,-50%) translateZ(70px)', transformStyle: 'preserve-3d' }}
          >
            <div className="h-full w-full animate-dial-in [animation-delay:560ms]" style={{ transformStyle: 'preserve-3d' }}>
              {Array.from({ length: 12 }, (_, i) => (
                <div
                  key={i}
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    transform: `translateZ(${-i * 1.4}px)`,
                    background: i === 11 ? '#140a04' : `rgba(255,106,31,${(0.5 - i * 0.03).toFixed(2)})`,
                  }}
                />
              ))}
              <div
                className="absolute inset-0 grid place-items-center rounded-full border-2 border-ledger bg-[radial-gradient(circle_at_35%_28%,#23232a,#0c0c0f_72%)] shadow-[0_0_40px_rgba(255,106,31,0.45),inset_0_0_30px_rgba(255,106,31,0.18)]"
                style={{ transform: 'translateZ(1px)' }}
              >
                <div className="absolute inset-[7%] rounded-full border border-dashed border-ledger/50" />
                <div className="relative text-center">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim" style={{ fontSize: Math.max(11, coin * 0.05) }}>
                    Credit score
                  </div>
                  <div
                    className="font-display font-bold leading-none tracking-[-0.04em] text-ink [text-shadow:0_0_24px_rgba(255,106,31,0.55)]"
                    style={{ fontSize: coin * 0.3 }}
                  >
                    <CountUp value={797} duration={1800} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-center gap-1.5" style={{ fontSize: Math.max(11, coin * 0.055) }}>
                    <span className="rounded-[3px] bg-ledger px-1.5 py-px font-mono font-bold text-paper">AA</span>
                    <span className="font-mono font-semibold tracking-[0.14em] text-info">VERIFIED</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 公转的证据卡 */}
          {CHIPS.map((c, i) => (
            <div
              key={c.dim}
              ref={(el) => {
                chipRefs.current[i] = el;
              }}
              className="absolute left-1/2 top-1/2"
              style={{ opacity: 0 }}
            >
              <div
                className="flex animate-fade-in items-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[12px] shadow-card"
                style={{ animationDelay: `${900 + i * 120}ms` } as CSSProperties}
              >
                <span className={`font-bold ${c.tone}`}>{c.mark}</span>
                <span className="text-ink">{t.dimensions[c.dim] ?? c.dim}</span>
                <span className="text-dim/60">#{c.hash}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-1 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-dim">{t.hero.sampleSeal}</p>
    </div>
  );
}
