'use client';

/**
 * ModuleCubes3D — 「把你的场景、算法、对手，写进考场」：
 * 四个可贡献模块（谈判场景 / 评分算法 / 对手引擎 / 接入协议）是四个自转的立方体，
 * 通过数据线连到中心「考场」核心，并轮流「入坞」——直观表达：你贡献的模块会被接进考场，成为全站考题。
 */
import { FlaskConical, Plug, Sigma, Swords } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { AgentMark } from './AgentMark';
import { centered, useStage3D, useStageScale } from './stage';

const W = 460;
const H = 380;
const S = 64; // 立方体边长
const ICONS = [FlaskConical, Sigma, Swords, Plug];
const SPOTS = [
  { x: -160, y: -100, z: -30 },
  { x: 160, y: -100, z: 20 },
  { x: -160, y: 105, z: 20 },
  { x: 160, y: 105, z: -30 },
];
const PERIOD = 8; // s：四个模块轮一圈

function SpinCube({ Icon, delay }: { Icon: typeof Plug; delay: number }) {
  const faces = [
    `translateZ(${S / 2}px)`,
    `rotateY(180deg) translateZ(${S / 2}px)`,
    `rotateY(90deg) translateZ(${S / 2}px)`,
    `rotateY(-90deg) translateZ(${S / 2}px)`,
    `rotateX(90deg) translateZ(${S / 2}px)`,
    `rotateX(-90deg) translateZ(${S / 2}px)`,
  ];
  return (
    <div className="p3d" style={{ ...centered(S, S), animation: `cube-spin 12s linear ${-delay}s infinite` }}>
      {faces.map((t, i) => (
        <div
          key={i}
          className={`grid place-items-center rounded-md border ${
            i < 4 ? 'border-ledger/70 bg-[#1c1009]/95 text-ledger' : 'border-ledger/40 bg-[#2a160b]/95 text-ledger/80'
          }`}
          style={{ ...centered(S, S), transform: t, boxShadow: 'inset 0 0 18px rgba(255,106,31,0.25)' }}
        >
          {i < 4 && <Icon size={26} strokeWidth={1.6} />}
        </div>
      ))}
    </div>
  );
}

export function ModuleCubes3D() {
  const t = useT();
  const { ref, scale } = useStageScale(W);
  const { stageRef, sceneRef } = useStage3D({
    base: (ax, ay) => `rotateX(${ax}deg) rotateY(${ay}deg)`,
    sway: [7, 14],
    tilt: [8, 12],
  });

  return (
    <div ref={ref} className="relative w-full overflow-x-clip" style={{ height: H * scale }}>
      <div
        ref={stageRef}
        className="absolute left-1/2 top-0 select-none"
        style={{ width: W, height: H, marginLeft: -W / 2, transform: `scale(${scale})`, transformOrigin: 'top center', perspective: 1000 }}
      >
        <div ref={sceneRef} className="p3d absolute inset-0">
          {/* 数据线：核心 → 各模块 */}
          <svg className="absolute" style={{ ...centered(W, H), transform: 'translateZ(-50px)' }} viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}>
            {SPOTS.map((p, i) => (
              <g key={i}>
                <line x1="0" y1="0" x2={p.x} y2={p.y} stroke="rgba(255,106,31,0.18)" strokeWidth="6" strokeLinecap="round" />
                <line className="animate-dash" x1={p.x} y1={p.y} x2="0" y2="0" stroke="#FF6A1F" strokeWidth="1.5" strokeDasharray="5 7" />
              </g>
            ))}
          </svg>

          {/* 核心：考场 */}
          <div className="p3d absolute" style={centered(0, 0)}>
            <div className="absolute" style={{ ...centered(190, 190), transform: 'translateZ(-20px)' }}>
              <div className="animate-ring-pulse h-full w-full rounded-full border border-ledger/70" />
            </div>
            <div
              className="absolute animate-spin-b rounded-full border border-dashed border-ledger/50"
              style={{ ...centered(170, 170), transform: 'translateZ(-10px)' }}
            />
            <div
              className="absolute grid place-items-center rounded-full border-2 border-ledger bg-[radial-gradient(circle_at_35%_30%,#24242b,#0b0b0d_70%)] shadow-[0_0_50px_rgba(255,106,31,0.45)]"
              style={centered(128, 128)}
            >
              <div className="flex flex-col items-center">
                <AgentMark seed="exam-core" variant={{ shape: 1, eyes: 1, antenna: 3, accent: '#FF6A1F' }} size={52} />
                <span className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-ledger">{t.oneMore.core}</span>
              </div>
            </div>
          </div>

          {/* 模块立方体：自转 + 轮流入坞 */}
          {SPOTS.map((p, i) => {
            const Icon = ICONS[i];
            return (
              <div key={i} className="p3d absolute" style={{ ...centered(0, 0), transform: `translate3d(${p.x}px, ${p.y}px, ${p.z}px)` }}>
                <div
                  className="p3d"
                  style={
                    {
                      '--dx': `${Math.round(-p.x * 0.42)}px`,
                      '--dy': `${Math.round(-p.y * 0.42)}px`,
                      animation: `dock ${PERIOD}s cubic-bezier(0.5,0,0.3,1) ${i * (PERIOD / 4)}s infinite`,
                    } as React.CSSProperties
                  }
                >
                  <SpinCube Icon={Icon} delay={i * 2.5} />
                  <span
                    className="absolute whitespace-nowrap rounded-[3px] border border-line-strong bg-surface px-2 py-0.5 text-center font-mono text-[11px] text-ink"
                    style={{ left: '50%', top: S / 2 + 14, transform: 'translate(-50%, 0) translateZ(40px)' }}
                  >
                    {t.oneMore.modules[i]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
