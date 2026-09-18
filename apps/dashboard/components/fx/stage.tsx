'use client';

/**
 * 3D 场景基础件（纯 CSS 3D，零依赖）：
 * - useStage3D：舞台持续微摆 + 鼠标视差倾斜；离开视口 / 标签页隐藏时暂停 rAF；
 *   reduced-motion 下只渲染静态姿态。每帧直接写 style，不触发 React 重渲染。
 * - useStageScale：按容器宽度等比缩放固定设计尺寸的场景（手机上整体缩小）。
 * - Cube：六面体（CSS 盒子），可在任意面放内容。
 * - stand()：等轴测地面上「站起来」并正对观众的变换（billboard）。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export function prefersReduced() {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

export function useStage3D({
  base,
  sway = [4, 6],
  tilt = [8, 10],
  onFrame,
}: {
  /** 由（额外 X 旋转, 额外 Y/Z 旋转）生成场景 transform。 */
  base: (ax: number, ay: number) => string;
  sway?: [number, number];
  tilt?: [number, number];
  onFrame?: (time: number) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const cfg = useRef({ base, sway, tilt, onFrame });
  cfg.current = { base, sway, tilt, onFrame };

  useEffect(() => {
    const stage = stageRef.current;
    const scene = sceneRef.current;
    if (!stage || !scene) return;
    const reduced = prefersReduced();
    let mx = 0,
      my = 0,
      tmx = 0,
      tmy = 0,
      raf = 0,
      visible = false,
      clock = 0,
      last = performance.now();

    const render = (t: number) => {
      const c = cfg.current;
      mx += (tmx - mx) * 0.06;
      my += (tmy - my) * 0.06;
      const ax = Math.sin(t * 0.4) * c.sway[0] + my;
      const ay = Math.sin(t * 0.27 + 1.3) * c.sway[1] + mx;
      scene.style.transform = c.base(ax, ay);
      c.onFrame?.(t);
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
    render(0.8);

    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      const c = cfg.current;
      tmx = ((e.clientX - r.left) / r.width - 0.5) * c.tilt[1] * 2;
      tmy = -((e.clientY - r.top) / r.height - 0.5) * c.tilt[0] * 2;
    };
    const onLeave = () => {
      tmx = 0;
      tmy = 0;
    };
    const onVis = () => (document.hidden ? stop() : start());
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([e]) => {
            visible = e.isIntersecting;
            if (visible) start();
            else stop();
          })
        : null;
    if (io) io.observe(stage);
    else {
      visible = true;
      start();
    }
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      io?.disconnect();
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return { stageRef, sceneRef };
}

/** 固定设计宽度的场景按容器等比缩放。 */
export function useStageScale(designWidth: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / designWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [designWidth]);
  return { ref, scale };
}

/** 等轴测地面的旋转角（场景 transform 用 rotateX(ISO_X) rotateZ(ISO_Z)）。 */
export const ISO_X = 58;
export const ISO_Z = -40;

/** 在地面坐标 (x, y) 处站立并正对观众：h = 元素高度，bottom = 底边离地高度。 */
export function stand(x: number, y: number, h: number, bottom = 0) {
  return `translate3d(${x}px, ${y}px, ${bottom + h / 2}px) rotateZ(${-ISO_Z}deg) rotateX(-90deg)`;
}

/** 以中心为原点放置子元素的绝对定位样式。 */
export function centered(w: number, h: number): CSSProperties {
  return { position: 'absolute', left: '50%', top: '50%', width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2 };
}

export function Cube({
  w,
  d,
  h,
  className = '',
  faceClass = 'bg-surface border border-line-strong',
  top,
  front,
  style,
}: {
  w: number;
  d: number;
  h: number;
  className?: string;
  faceClass?: string;
  top?: ReactNode;
  front?: ReactNode;
  style?: CSSProperties;
}) {
  // 竖直方向为 z（地面坐标系）：顶面在 +z，侧面立起来
  const faces: Array<{ key: string; w: number; h: number; t: string; content?: ReactNode; shade: string }> = [
    { key: 'top', w, h: d, t: `translateZ(${h}px)`, content: top, shade: '' },
    { key: 'front', w, h, t: `translateY(${d / 2}px) translateZ(${h / 2}px) rotateX(-90deg)`, content: front, shade: 'brightness-90' },
    { key: 'back', w, h, t: `translateY(${-d / 2}px) translateZ(${h / 2}px) rotateX(90deg) rotateZ(180deg)`, shade: 'brightness-75' },
    { key: 'right', w: d, h, t: `translateX(${w / 2}px) translateZ(${h / 2}px) rotateY(90deg) rotateZ(-90deg)`, shade: 'brightness-75' },
    { key: 'left', w: d, h, t: `translateX(${-w / 2}px) translateZ(${h / 2}px) rotateY(-90deg) rotateZ(90deg)`, shade: 'brightness-90' },
  ];
  return (
    <div className={`p3d ${className}`} style={{ ...centered(w, d), ...style }}>
      {faces.map((f) => (
        <div
          key={f.key}
          className={`absolute ${faceClass} ${f.shade}`}
          style={{ ...centered(f.w, f.h), transform: f.t, backfaceVisibility: 'hidden' }}
        >
          {f.content}
        </div>
      ))}
    </div>
  );
}
