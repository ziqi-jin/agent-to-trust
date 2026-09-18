'use client';

/**
 * LoopScene3D — 「信任是怎么产生的」等轴测场景，四步与左侧步骤同步：
 *   01 仿真：市场地面上 6 个 Agent 各自活动；
 *   02 交易：Agent 两两之间出现交易连线，信用点沿线流动；
 *   03 证据：每笔交易产出证据卡飞向中心，证据块逐层落下堆成证据链；
 *   04 评分：证据链顶部升起光柱，印章盖出分数。
 * 前面步骤的元素保留（叠加式），一眼看出「仿真 → 交易 → 证据 → 分数」是一条链。
 */
import { ScoreSeal } from '../ScoreSeal';
import { useT } from '@/lib/i18n';
import { AgentMark } from './AgentMark';
import { Cube, ISO_X, ISO_Z, centered, stand, useStage3D, useStageScale } from './stage';

const W = 560;
const H = 470;
const PLANE = 400;
const R = 140;
const AGENTS = ['atlas', 'nova', 'crush', 'kite', 'orbit', 'sable'].map((seed, i) => {
  const a = ((i * 60 + 30) * Math.PI) / 180;
  return { seed, x: Math.round(Math.cos(a) * R), y: Math.round(Math.sin(a) * R) };
});
const PAIRS: Array<[number, number]> = [
  [0, 1],
  [2, 3],
  [4, 5],
];
const RESULTS = [
  { mark: '✓', cls: 'bg-info text-paper' },
  { mark: '✓', cls: 'bg-info text-paper' },
  { mark: '◐', cls: 'bg-amber text-paper' },
  { mark: '✓', cls: 'bg-info text-paper' },
  { mark: '✗', cls: 'bg-seal text-paper' },
  { mark: '✓', cls: 'bg-info text-paper' },
];
const SLABS = 5;
const SLAB_H = 10;
const SLAB_GAP = 13;
const STACK_TOP = SLABS * SLAB_GAP;

function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return { d: `M${a.x},${a.y} Q${Math.round(mx * 0.45)},${Math.round(my * 0.45)} ${b.x},${b.y}`, mx: mx * 0.7, my: my * 0.7 };
}

export function LoopScene3D({ step, cycle }: { step: number; cycle: number }) {
  const t = useT();
  const { ref, scale } = useStageScale(W);
  const { stageRef, sceneRef } = useStage3D({
    base: (ax, ay) => `translateY(26px) rotateX(${ISO_X + ax}deg) rotateZ(${ISO_Z + ay}deg)`,
    sway: [3, 6],
    tilt: [6, 8],
  });
  const curves = PAIRS.map(([a, b]) => curve(AGENTS[a], AGENTS[b]));

  return (
    <div ref={ref} className="relative w-full overflow-x-clip" style={{ height: H * scale }}>
      <div
        ref={stageRef}
        className="absolute left-1/2 top-0 select-none"
        style={{ width: W, height: H, marginLeft: -W / 2, transform: `scale(${scale})`, transformOrigin: 'top center', perspective: 1500 }}
      >
        <div ref={sceneRef} className="p3d absolute inset-0">
          {/* 地面 */}
          <div className="p3d" style={centered(PLANE, PLANE)}>
            <div className="bg-tech-grid absolute inset-0 rounded-2xl border border-line-strong bg-surface/60" />
            <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle,rgba(255,106,31,0.16),transparent_62%)]" />
            <div
              className="absolute rounded-full border border-dashed border-ledger/35"
              style={centered(R * 2 + 70, R * 2 + 70)}
            />
            <span className="absolute bottom-3 left-4 font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
              {t.fx.market}
            </span>
          </div>

          {/* 02 交易连线（地面上的 SVG） */}
          <svg
            className="absolute transition-opacity duration-700"
            style={{ ...centered(PLANE, PLANE), opacity: step >= 1 ? 1 : 0 }}
            viewBox={`${-PLANE / 2} ${-PLANE / 2} ${PLANE} ${PLANE}`}
          >
            {curves.map((c, i) => (
              <g key={i}>
                <path d={c.d} fill="none" stroke="rgba(255,106,31,0.25)" strokeWidth="6" strokeLinecap="round" />
                <path className="animate-dash" d={c.d} fill="none" stroke="#FF6A1F" strokeWidth="2" strokeDasharray="6 6" />
                <circle r="5" fill="#FFB27A">
                  <animateMotion dur={`${1.4 + i * 0.3}s`} repeatCount="indefinite" path={c.d} />
                </circle>
              </g>
            ))}
          </svg>

          {/* 04 地面脉冲环（中心） */}
          {step >= 3 && (
            <div className="absolute" style={centered(150, 150)}>
              <div className="animate-ring-pulse h-full w-full rounded-full border-2 border-ledger" />
            </div>
          )}

          {/* Agent：地面影子 + 站立的角色 + 头顶结果签 */}
          {AGENTS.map((a, i) => (
            <div key={a.seed} className="p3d absolute" style={centered(0, 0)}>
              <div
                className="absolute rounded-full bg-[radial-gradient(circle,rgba(0,0,0,0.7),transparent_70%)]"
                style={{ ...centered(46, 46), transform: `translate3d(${a.x}px, ${a.y}px, 1px)` }}
              />
              <div className="absolute" style={{ ...centered(56, 86), transform: stand(a.x, a.y, 86) }}>
                <div className="flex h-full flex-col items-center justify-end">
                  <span
                    className={`mb-1 grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold transition-all duration-500 ${RESULTS[i].cls} ${
                      step >= 2 ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                    }`}
                    style={{ transitionDelay: step >= 2 ? `${i * 120}ms` : '0ms' }}
                  >
                    {RESULTS[i].mark}
                  </span>
                  <div className="animate-float" style={{ animationDelay: `${-i * 0.9}s` }}>
                    <AgentMark seed={a.seed} size={52} />
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* 03 证据卡飞入 */}
          {step === 2 &&
            curves.map((c, i) => (
              <div
                key={`fly-${cycle}-${i}`}
                className="absolute rounded-md border border-ledger/60 bg-surface px-2 py-1 font-mono text-[11px] text-ink shadow-glow-sm"
                style={
                  {
                    ...centered(96, 26),
                    '--fx': `${Math.round(c.mx)}px`,
                    '--fy': `${Math.round(c.my)}px`,
                    animation: `evi-fly 1.6s cubic-bezier(0.5,0,0.3,1) ${i * 0.35}s infinite both`,
                  } as React.CSSProperties
                }
              >
                <span className="text-info">✓</span> evidence
              </div>
            ))}

          {/* 03 证据链：证据块逐层落下 */}
          {step >= 2 &&
            Array.from({ length: SLABS }, (_, i) => (
              <div
                key={`slab-${cycle}-${i}`}
                className="p3d absolute"
                style={
                  {
                    ...centered(0, 0),
                    '--from': `${i * SLAB_GAP + 180}px`,
                    '--to': `${i * SLAB_GAP}px`,
                    animation: `slab-drop 0.7s cubic-bezier(0.3,1.3,0.5,1) ${i * 0.22}s both`,
                  } as React.CSSProperties
                }
              >
                <Cube
                  w={92}
                  d={92}
                  h={SLAB_H}
                  faceClass="border border-ledger/50 bg-[#1a120c]"
                  top={
                    <div className="grid h-full w-full place-items-center bg-[#221409] font-mono text-[11px] text-ledger">
                      {i === SLABS - 1 ? t.fx.stack : `#${['9f2c', '41be', 'c07d', '5a19', 'e2f8'][i]}`}
                    </div>
                  }
                />
              </div>
            ))}

          {/* 04 光柱 + 印章 */}
          {step >= 3 && (
            <>
              <div
                className="absolute animate-fade-in bg-gradient-to-t from-ledger/45 via-ledger/10 to-transparent"
                style={{ ...centered(84, 170), transform: stand(0, 0, 170, STACK_TOP) }}
              />
              <div className="absolute" style={{ ...centered(124, 124), transform: stand(0, 0, 124, STACK_TOP + 70) }}>
                <ScoreSeal key={`seal-${cycle}`} score={797} tested rank={3} size={124} delayMs={150} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
