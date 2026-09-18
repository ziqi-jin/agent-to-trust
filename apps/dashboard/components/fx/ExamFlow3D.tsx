'use client';

/**
 * ExamFlow3D — 「把你的 Agent 送进考场」：三座平台一字排开，你的 Agent 随步骤跳到对应平台。
 *   01 运行：Agent 站上起点，身边浮着三种接入形态（OpenAI 兼容 / 本地 CLI / A2A）；
 *   02 考试：题卡绕着考台旋转（本地跑题，原始输出不出本机）；
 *   03 盖章：印章落下、README 徽章生成。
 */
import { ScoreSeal } from '../ScoreSeal';
import { useT } from '@/lib/i18n';
import { AgentMark } from './AgentMark';
import { Cube, ISO_X, ISO_Z, centered, stand, useStage3D, useStageScale } from './stage';

const W = 560;
const H = 420;
const GAP = 165;
const PED = 112;
const PED_H = 22;
const XS = [-GAP, 0, GAP];

export function ExamFlow3D({ step, cycle }: { step: number; cycle: number }) {
  const t = useT();
  const { ref, scale } = useStageScale(W);
  const { stageRef, sceneRef } = useStage3D({
    base: (ax, ay) => `translateY(40px) rotateX(${ISO_X + ax}deg) rotateZ(${ISO_Z + ay}deg)`,
    sway: [3, 5],
    tilt: [6, 8],
  });
  const questions = ['negotiation', 'delivery', 'integrity'].map((d) => t.dimensions[d] ?? d);

  return (
    <div ref={ref} className="relative w-full overflow-x-clip" style={{ height: H * scale }}>
      <div
        ref={stageRef}
        className="absolute left-1/2 top-0 select-none"
        style={{ width: W, height: H, marginLeft: -W / 2, transform: `scale(${scale})`, transformOrigin: 'top center', perspective: 1500 }}
      >
        <div ref={sceneRef} className="p3d absolute inset-0">
          {/* 地面 */}
          <div className="bg-tech-grid absolute rounded-2xl border border-line-strong bg-surface/50" style={centered(560, 250)} />
          <div
            className="absolute rounded-2xl bg-[radial-gradient(ellipse,rgba(255,106,31,0.14),transparent_65%)]"
            style={centered(560, 250)}
          />
          {/* 平台之间的流动虚线 */}
          <div className="dash-line absolute animate-dash-flow" style={{ ...centered(GAP * 2, 2), transform: 'translateZ(1px)' }} />

          {/* 当前平台下的脉冲环 */}
          <div className="absolute" style={{ ...centered(170, 170), transform: `translate3d(${XS[step]}px, 0, 1px)`, transition: 'transform 0.8s cubic-bezier(0.16,1,0.3,1)' }}>
            <div className="animate-ring-pulse h-full w-full rounded-full border-2 border-ledger" />
          </div>

          {/* 三座平台 */}
          {XS.map((x, i) => {
            const active = i === step;
            return (
              <div key={i} className="p3d absolute" style={{ ...centered(0, 0), transform: `translate3d(${x}px, 0, 0)` }}>
                <Cube
                  w={PED}
                  d={PED}
                  h={PED_H}
                  faceClass={`border transition-colors duration-500 ${active ? 'border-ledger bg-[#2a160b]' : 'border-line-strong bg-panel'}`}
                  top={
                    <div
                      className={`grid h-full w-full place-items-center font-mono text-[12px] uppercase tracking-[0.14em] transition-colors duration-500 ${
                        active ? 'bg-[#2a160b] text-ledger' : 'bg-surface text-dim'
                      }`}
                    >
                      <span>
                        0{i + 1} · {t.fx.stations[i]}
                      </span>
                    </div>
                  }
                />
              </div>
            );
          })}

          {/* 01 接入形态标签 */}
          {t.fx.shapes.map((label, j) => (
            <div
              key={label}
              className="absolute whitespace-nowrap rounded-md border border-line-strong bg-surface px-2 py-1 text-center font-mono text-[11px] text-ink transition-all duration-500"
              style={{
                ...centered(128, 26),
                transform: stand(-GAP - 20, -95, 26, 20 + j * 34),
                opacity: step === 0 ? 1 : 0.15,
                transitionDelay: step === 0 ? `${j * 120}ms` : '0ms',
              }}
            >
              <span className="text-info">●</span> {label}
            </div>
          ))}

          {/* 02 题卡绕考台旋转 */}
          <div
            className="p3d absolute transition-opacity duration-500"
            style={{ ...centered(0, 0), transform: `translateZ(${PED_H}px)`, opacity: step === 1 ? 1 : 0.12 }}
          >
            <div className="p3d animate-spin-c">
              {questions.map((q, k) => (
                <div
                  key={q}
                  className="absolute rounded-md border border-ledger/60 bg-surface px-2 py-1.5 text-center font-mono text-[11px] text-ink shadow-glow-sm"
                  style={{
                    ...centered(92, 44),
                    transform: `rotateZ(${k * 120}deg) translate3d(0, 88px, 34px) rotateX(-90deg)`,
                    backfaceVisibility: 'hidden',
                  }}
                >
                  <span className="block text-[11px] text-ledger">Q{k + 1}</span>
                  {q}
                </div>
              ))}
            </div>
          </div>

          {/* 03 光柱 + 印章 + 徽章 */}
          {step === 2 && (
            <>
              <div
                className="absolute animate-fade-in bg-gradient-to-t from-ledger/45 via-ledger/10 to-transparent"
                style={{ ...centered(96, 190), transform: stand(GAP, 0, 190, PED_H) }}
              />
              <div className="absolute" style={{ ...centered(110, 110), transform: stand(GAP, 0, 110, PED_H + 120) }}>
                <ScoreSeal key={`exam-seal-${cycle}`} score={797} tested rank={3} size={110} delayMs={500} />
              </div>
              {/* 定位与入场动画分两层：动画的 transform 不能覆盖 3D 定位 */}
              <div className="absolute" style={{ ...centered(118, 24), transform: stand(GAP + 10, 92, 24, 8) }}>
                <span className="flex h-full animate-pop-in overflow-hidden rounded-[4px] border border-line-strong font-mono text-[11px] shadow-glow-sm [animation-delay:900ms]">
                  <span className="grid place-items-center bg-panel px-2 text-dim">A2T</span>
                  <span className="grid flex-1 place-items-center bg-ledger font-semibold text-paper">797 · AA</span>
                </span>
              </div>
            </>
          )}

          {/* 你的 Agent：随步骤跳台 */}
          <div
            className="absolute"
            style={{
              ...centered(84, 96),
              transform: stand(XS[step], 0, 96, PED_H),
              transition: 'transform 0.8s cubic-bezier(0.5,0,0.3,1)',
            }}
          >
            <div key={`hop-${step}-${cycle}`} className="animate-hop flex h-full flex-col items-center justify-end">
              <span className="mb-1 rounded-[3px] border border-ledger/60 bg-ledger-soft px-1.5 font-mono text-[11px] uppercase tracking-wider text-ledger">
                {t.fx.yourAgent}
              </span>
              <AgentMark seed="your-agent" variant={{ accent: '#FF6A1F' }} size={62} verified={step === 2} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
