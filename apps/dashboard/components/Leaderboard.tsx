"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Radio,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { LeaderboardEntry, StatsSummary } from "@/lib/api";
import { useT, fill } from "@/lib/i18n";
import { ScoreSeal } from "./ScoreSeal";
import { MedalBar } from "./MedalBar";
import { CopyButton } from "./CopyButton";
import { Reveal } from "./motion";
import { SectionHead } from "./SectionHead";
import { AgentMark } from "./fx/AgentMark";
import { DIMENSIONS } from "@a2t/core";

function SourceTag({ source }: { source: LeaderboardEntry["source"] }) {
  const t = useT();
  if (source === "real-benchmark") {
    return (
      <span className="chip border-seal/30 bg-seal/5 font-semibold text-seal">
        {t.leaderboard.sourceSdk}
      </span>
    );
  }
  if (source === "benchmark") {
    return (
      <span className="chip border-brass/40 bg-brass/5 text-brass">
        {t.leaderboard.sourceBenchmark}
      </span>
    );
  }
  if (source === "simulation") {
    return (
      <span className="chip border-hairline text-dim">
        {t.leaderboard.sourceSimulation}
      </span>
    );
  }
  return null;
}

/** 名次：衬线数字；前三加一圈黄铜双环（像压在账页上的小钢印）。 */
function RankMark({ rank }: { rank: number }) {
  const str = String(rank).padStart(2, "0");
  if (rank <= 3) {
    return (
      <span className="relative grid h-9 w-9 place-items-center rounded-full border border-brass bg-brass/5 font-display text-[15px] font-semibold text-brass">
        <span
          aria-hidden
          className="absolute inset-[3px] rounded-full border border-dashed border-brass/50"
        />
        {str}
      </span>
    );
  }
  return (
    <span className="pl-2 font-display text-lg font-medium tabular-nums text-dim">
      {str}
    </span>
  );
}

const GRID_MD =
  "md:grid-cols-[3rem_minmax(0,1fr)_4rem_6rem_4.5rem_5.5rem] lg:grid-cols-[3rem_minmax(0,1fr)_4.5rem_6.5rem_5rem_9rem_5.5rem]";

function Row({
  e,
  onSelect,
  board,
  index,
}: {
  e: LeaderboardEntry;
  onSelect: (id: string) => void;
  board: "capability" | "behavior";
  index: number;
}) {
  const t = useT();
  const isBehavior = board === "behavior";
  // 口径统一（v0.2）：印章 = 排序键 = 绝对分，与详情页同值；行为榜仍显示行为分。
  const val = isBehavior ? e.behaviorScore : e.score;
  // 临时评级（对齐酒馆口径）：证据 <5 条灰显混排，不隐藏
  const provisional = e.evidenceCount < 5;
  const tested = isBehavior
    ? e.inArena && e.behaviorScore !== null
    : e.source === "real-benchmark" || e.source === "benchmark";
  const conf = Math.round(e.confidence * 100);

  return (
    <li
      className="animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <button
        onClick={() => onSelect(e.agentId)}
        className={`group relative grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-4 text-left transition-colors duration-200 hover:bg-ledger-soft/60 md:gap-x-4 md:px-5 ${GRID_MD} ${provisional ? "opacity-60 hover:opacity-100" : ""}`}
      >
        {/* 悬停时左侧亮起的强调条 */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1 origin-top scale-y-0 bg-ledger transition-transform duration-300 ease-out-expo group-hover:scale-y-100"
        />

        <RankMark rank={e.rank} />

        {/* Agent：头像单独一列，名字 / 标签 / 模型 / 勋章都对齐在头像右侧 */}
        <span className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 hidden shrink-0 rounded-md border border-line bg-night p-0.5 sm:block">
            <AgentMark
              seed={e.name}
              size={34}
              verified={e.verificationLevel === "verified"}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="flex min-w-0 items-center gap-1 truncate text-[15.5px] font-semibold text-ink">
              <AgentMark
                seed={e.name}
                size={24}
                verified={e.verificationLevel === "verified"}
                className="mr-1 sm:hidden"
              />
              <span className="truncate">{e.name}</span>
              <ChevronRight
                size={15}
                className="shrink-0 -translate-x-1 text-ledger opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100"
              />
            </span>
            {provisional && (
              <span className="chip border-hairline text-dim">
                {t.leaderboard.provisional}
              </span>
            )}
            {e.agentVersion && (
              <span className="chip border-hairline text-dim">
                v{e.agentVersion}
              </span>
            )}
            <SourceTag source={e.source} />
            {isBehavior && e.counterpartModes?.includes("live") && (
              <span className="chip border-seal/30 bg-seal/5 font-semibold text-seal">
                <Radio size={10} />
                {t.leaderboard.liveBadge}
              </span>
            )}
            {e.verificationLevel === "verified" && (
              <span className="chip hidden border-brass bg-brass font-semibold text-paper sm:inline-flex">
                VERIFIED ✦
              </span>
            )}
            <span className="w-full font-mono text-[11px] uppercase tracking-wider text-dim md:hidden">
              {fill(t.leaderboard.mobileRow, {
                confidence: conf,
                evidence: e.evidenceCount,
              })}
              {e.model ? ` · ${e.model}` : ""}
            </span>
            {e.model && (
              <span className="hidden w-full font-mono text-[11px] text-dim md:block lg:hidden">
                {e.model}
              </span>
            )}
            {/* 勋章条（服务端权威派生；每维最多一枚，未解锁显示灰档） */}
            <MedalBar
              badges={e.badges ?? []}
              size={18}
              className="mt-0.5 w-full"
            />
          </span>
        </span>

        {/* 证据 */}
        <span className="hidden text-right font-mono text-sm tabular-nums text-dim md:block">
          {e.evidenceCount}
        </span>

        {/* 置信：百分比 + 细条 */}
        <span className="hidden flex-col items-end gap-1.5 md:flex">
          <span className="font-mono text-sm tabular-nums text-ink">
            {conf}%
          </span>
          <span className="block h-1.5 w-20 overflow-hidden border border-line bg-surface">
            <span
              className="block h-full origin-left animate-grow-x bg-ledger"
              style={{
                width: `${Math.max(3, conf)}%`,
                animationDelay: `${200 + index * 45}ms`,
              }}
            />
          </span>
        </span>

        {/* 分数列（v0.2：榜单1 = 绝对信用分；行为榜 = 考场信用分，资格线可见化） */}
        <span className="hidden text-right font-mono text-sm tabular-nums text-dim md:block">
          {e.score ?? "—"}
        </span>

        {/* 模型（agent 显式上报，未提供显示 —） */}
        <span
          className="hidden truncate text-right font-mono text-xs text-dim lg:block"
          title={e.model ?? undefined}
        >
          {e.model ?? "—"}
        </span>

        {/* 印章 = 分数本身 */}
        <span className="flex justify-end transition-transform duration-300 ease-out-expo group-hover:scale-105">
          <ScoreSeal
            score={val}
            tested={tested}
            rank={e.rank}
            size={60}
            delayMs={index * 55}
          />
        </span>
      </button>
    </li>
  );
}

/** 分段切换：底块按选中按钮的实际位置/宽度滑动（标签长度不等也对齐）。 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[value];
      if (el)
        setBox({
          left: el.offsetLeft,
          top: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value, options]);

  return (
    <div className="relative inline-flex max-w-full flex-wrap rounded-md border border-line-strong bg-surface p-1 sm:flex-nowrap">
      {box && (
        <span
          aria-hidden
          className="absolute rounded-[4px] bg-ledger shadow-glow-sm transition-all duration-300 ease-out-expo"
          style={box}
        />
      )}
      {options.map(([v, label]) => (
        <button
          key={v}
          ref={(el) => {
            refs.current[v] = el;
          }}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={v === value}
          className={`relative z-10 whitespace-nowrap rounded-[4px] px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] transition-colors duration-300 ${
            v === value ? "font-semibold text-paper" : "text-dim hover:text-ink"
          } ${!box && v === value ? "bg-ledger" : ""}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Leaderboard({
  entries,
  onSelect,
  board,
  setBoard,
  summary,
  dims,
  setDims,
  mode,
  setMode,
}: {
  entries: LeaderboardEntry[];
  onSelect: (id: string) => void;
  board: "capability" | "behavior";
  setBoard: (b: "capability" | "behavior") => void;
  summary: StatsSummary | null;
  dims: string[];
  setDims: (d: string[]) => void;
  mode: "scripted" | "live" | "all";
  setMode: (m: "scripted" | "live" | "all") => void;
}) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const top10 = entries.slice(0, 10);
  const rest = entries.slice(10);
  const isBehavior = board === "behavior";
  const toggleDim = (d: string) =>
    setDims(dims.includes(d) ? dims.filter((x) => x !== d) : [...dims, d]);
  const listCmd = `npx agent-to-trust test --name my-agent --url <你的agent地址>\n# 本地 CLI agent：--cmd "aider --message"　·　指模型试跑：--model <model> --base-url <url> --api-key <key>`;

  return (
    <section
      id="leaderboard"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24"
    >
      {/* 分册头 */}
      <SectionHead
        className="mb-8"
        label="§1 — The Register"
        title={t.leaderboard.title}
        sub={
          isBehavior
            ? t.leaderboard.subtitleBehavior
            : t.leaderboard.subtitleCapability
        }
        aside={
          <Segmented
            value={board}
            onChange={setBoard}
            options={[
              ["capability", t.leaderboard.tabCapability],
              ["behavior", t.leaderboard.tabBehavior],
            ]}
          />
        }
      />

      {/* 特色位（榜2）：真实环境 · 真实 agent 评测 */}
      {isBehavior && (
        <div className="mb-6 flex animate-pop-in gap-3 rounded-lg border border-seal/40 border-l-[5px] border-l-seal bg-seal/[0.04] px-5 py-4">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-seal/10 text-seal">
            <Radio size={16} />
          </span>
          <div>
            <p className="font-display text-sm font-bold text-seal">
              {t.leaderboard.highlightTitle}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-dim">
              {t.leaderboard.highlightBody}
            </p>
          </div>
        </div>
      )}

      <Reveal
        delay={80}
        className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-lift"
      >
        {/* 工具栏：统计 + 处理方式 + 维度筛选 */}
        <div className="bg-dots border-b border-line bg-paper px-4 py-4 md:px-5">
          <p className="flex items-center gap-2 font-mono text-[12px] tracking-wide text-ink">
            {fill(t.leaderboard.statsLine, {
              exam: summary?.leaderboard1Participants ?? "—",
              behavior: summary?.leaderboard2Participants ?? "—",
              queue: summary?.queueWaiting ?? 0,
            })}
            {(summary?.queueWaiting ?? 0) > 0 && (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-seal" />
            )}
          </p>

          {/* 处理方式筛选（榜2）：脚本 / 真实 / 全部——两套分数各自成榜（T8 /leaderboard?mode=） */}
          {isBehavior && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
                {t.leaderboard.modeLabel}
              </span>
              {(
                [
                  ["all", t.leaderboard.modeAll],
                  ["live", t.leaderboard.modeLive],
                  ["scripted", t.leaderboard.modeScripted],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className="pill"
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* 维度筛选 / 组合重排（0912）：勾选维度 → 按所选维度均分降序重排；不改底层分数 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
              <SlidersHorizontal size={12} />
              {t.leaderboard.filterLabel}
            </span>
            {DIMENSIONS.map((d) => (
              <button
                key={d}
                onClick={() => toggleDim(d)}
                aria-pressed={dims.includes(d)}
                className="pill"
              >
                {t.dimensions[d] ?? d}
              </button>
            ))}
            {dims.length > 0 && (
              <button
                onClick={() => setDims([])}
                className="inline-flex animate-fade-in items-center gap-1 rounded-[4px] px-2 py-1 font-mono text-[12px] text-seal transition hover:bg-seal/5"
              >
                <X size={12} />
                {t.leaderboard.filterClear}
              </button>
            )}
          </div>
          <p className="mt-2.5 font-mono text-[11px] text-dim">
            {dims.length > 0
              ? fill(t.leaderboard.filterActive, { n: dims.length })
              : t.leaderboard.filterHint}
          </p>
        </div>

        {/* 表头 */}
        <div
          className={`hidden gap-4 border-b border-line bg-panel px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-dim md:grid ${GRID_MD}`}
        >
          <span>Rank</span>
          <span>Registered Agent</span>
          <span className="text-right">{t.leaderboard.colEvidence}</span>
          <span className="text-right">{t.leaderboard.colConfidence}</span>
          <span className="text-right">
            {isBehavior ? t.leaderboard.colExam : t.leaderboard.colWeighted}
          </span>
          <span className="hidden text-right lg:block">
            {t.leaderboard.colModel}
          </span>
          <span className="text-right">Seal</span>
        </div>

        {entries.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full border-2 border-dashed border-hairline font-mono text-lg text-dim">
              ?
            </div>
            <p className="font-display text-lg font-bold text-ink">
              {t.leaderboard.emptyTitle}
            </p>
            <p className="mt-2 text-sm text-dim">{t.leaderboard.emptyDesc}</p>
            <div className="relative mx-auto mt-5 inline-block max-w-full">
              <code className="block whitespace-pre-wrap break-words rounded-md border border-line-strong bg-night py-2.5 pl-4 pr-20 text-left font-mono text-xs text-ledger">
                {
                  "npx agent-to-trust test --url <your-agent-url> --name my-agent"
                }
              </code>
              <CopyButton
                text="npx agent-to-trust test --url <your-agent-url> --name my-agent"
                className="absolute right-2 top-2"
                dark
              />
            </div>
          </div>
        ) : (
          <>
            <ol className="divide-y divide-line">
              {top10.map((e, i) => (
                <Row
                  key={`${board}-${e.agentId}`}
                  e={e}
                  onSelect={onSelect}
                  board={board}
                  index={i}
                />
              ))}
              {showAll &&
                rest.map((e, i) => (
                  <Row
                    key={`${board}-${e.agentId}`}
                    e={e}
                    onSelect={onSelect}
                    board={board}
                    index={i}
                  />
                ))}
            </ol>

            {rest.length > 0 && (
              <button
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                className="flex w-full items-center justify-center gap-2 border-t border-line bg-paper px-4 py-3.5 font-mono text-[12px] font-medium text-ink transition hover:bg-ledger-soft"
              >
                {showAll
                  ? t.common.collapse
                  : fill(t.leaderboard.moreRows, { n: rest.length }).replace(
                      /\s*[⌄▾↓]\s*$/,
                      "",
                    )}
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-300 ${showAll ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </>
        )}
      </Reveal>

      {/* 上榜方式：终端风格命令卡 */}
      <Reveal
        delay={120}
        className="mt-8 grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-[minmax(0,14rem)_1fr] md:items-center md:gap-5 md:p-5"
      >
        <span className="text-sm font-medium leading-relaxed text-ink">
          {t.leaderboard.listHint}
        </span>
        <div className="relative min-w-0">
          <code className="block whitespace-pre-wrap break-words rounded-md border border-line-strong bg-night py-3 pl-4 pr-20 font-mono text-xs leading-relaxed text-ink">
            <span className="text-ledger">$</span> npx agent-to-trust test
            --name my-agent --url &lt;你的agent地址&gt;
            <br />
            <span className="text-dim/70">
              # 本地 CLI agent：--cmd &quot;aider
              --message&quot;　·　指模型试跑：--model &lt;model&gt; --base-url
              &lt;url&gt; --api-key &lt;key&gt;
            </span>
          </code>
          <CopyButton text={listCmd} className="absolute right-2 top-2" dark />
        </div>
      </Reveal>

      <div className="mt-6 space-y-3 border-l-2 border-line pl-4 font-mono text-[11.5px] leading-relaxed text-dim">
        <p>{t.medal.legend}</p>
        <p>
          {t.leaderboard.footnotePre}
          <span className="text-seal">{t.leaderboard.footnoteSdk}</span>
          {t.leaderboard.footnoteSdkDetail}
          <span className="text-brass">{t.leaderboard.footnoteBench}</span>
          {t.leaderboard.footnoteBenchDetail}
          {t.leaderboard.footnotePost}
        </p>
      </div>
    </section>
  );
}
