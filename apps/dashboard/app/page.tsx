'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  DIMENSION_LABELS,
  RESULT_LABELS,
  SOURCE_LABELS,
  type Agent,
  type Evidence,
  type ScoreResponse,
} from '@/lib/api';

const DIMENSIONS = Object.keys(DIMENSION_LABELS);
const SOURCES = Object.keys(SOURCE_LABELS);
const RESULTS = ['success', 'failure', 'partial'];

function scoreTone(score: number | null): string {
  if (score === null) return 'text-dim';
  if (score >= 700) return 'text-accent';
  if (score >= 400) return 'text-amber';
  return 'text-danger';
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ScoreRing({ confidence }: { confidence: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, confidence));
  return (
    <svg width="78" height="78" viewBox="0 0 78 78">
      <circle cx="39" cy="39" r={r} fill="none" stroke="#232B3A" strokeWidth="6" />
      <circle
        cx="39"
        cy="39"
        r={r}
        fill="none"
        stroke="#34D399"
        strokeWidth="6"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform="rotate(-90 39 39)"
      />
      <text
        x="39"
        y="44"
        textAnchor="middle"
        fill="#E6EAF2"
        fontSize="15"
        fontFamily="JetBrains Mono, monospace"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

export default function Page() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 新建 Agent 表单
  const [newName, setNewName] = useState('');

  // 提交 Evidence 表单
  const [evDimension, setEvDimension] = useState(DIMENSIONS[0]);
  const [evSource, setEvSource] = useState(SOURCES[0]);
  const [evResult, setEvResult] = useState('success');

  const refreshAgents = useCallback(async () => {
    const list = await api.listAgents();
    setAgents(list);
  }, []);

  useEffect(() => {
    refreshAgents().catch((e) => setError(e.message));
  }, [refreshAgents]);

  const loadDetail = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const [agent, ev, sc] = await Promise.all([
        api.getAgent(id),
        api.listEvidence(id),
        api.getScore(id),
      ]);
      setSelected(agent);
      setEvidence(ev);
      setScore(sc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const selectAgent = (id: string) => {
    setSelectedId(id);
    loadDetail(id);
  };

  const createAgent = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const agent = await api.createAgent(newName.trim());
      setNewName('');
      await refreshAgents();
      setSelectedId(agent.id);
      await loadDetail(agent.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitEvidence = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await api.addEvidence(selectedId, { dimension: evDimension, source: evSource, result: evResult });
      const [ev, sc] = await Promise.all([api.listEvidence(selectedId), api.computeScore(selectedId)]);
      setEvidence(ev);
      setScore(sc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dims = score?.dimensions ?? [];

  return (
    <div className="min-h-screen flex flex-col">
      {/* 顶栏 */}
      <header className="border-b border-edge bg-surface/60 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-700 tracking-tight text-bright">
            Agent Credit Lab
          </h1>
          <p className="text-dim text-xs font-mono mt-0.5">Don&apos;t trust an Agent. Test it.</p>
        </div>
        <div className="text-dim text-xs font-mono">baseline-v0.1</div>
      </header>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-danger text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：Agent 列表 + 新建 */}
        <aside className="w-72 border-r border-edge flex flex-col">
          <div className="p-3 border-b border-edge">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createAgent()}
              placeholder="新 Agent 名称…"
              className="w-full rounded-md bg-abyss border border-edge px-3 py-2 text-sm text-bright placeholder:text-dim focus:outline-none focus:border-accent/50"
            />
            <button
              onClick={createAgent}
              disabled={busy || !newName.trim()}
              className="mt-2 w-full rounded-md bg-accent/90 text-abyss font-semibold text-sm py-2 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              注册 Agent
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {agents.length === 0 && (
              <p className="text-dim text-sm px-3 py-6 text-center">暂无 Agent，先注册一个</p>
            )}
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => selectAgent(a.id)}
                className={`w-full text-left rounded-md px-3 py-2.5 mb-1 border transition-colors ${
                  a.id === selectedId
                    ? 'border-accent/50 bg-accent/10'
                    : 'border-transparent hover:bg-surface'
                }`}
              >
                <div className="font-mono text-sm text-bright truncate">{a.name}</div>
                <div className="text-dim text-xs mt-0.5 flex items-center gap-2">
                  <span className="uppercase tracking-wider">{a.verificationLevel}</span>
                  <span>·</span>
                  <span>{(a.capabilities ?? []).length} caps</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* 主区：Profile */}
        <main className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-dim text-sm">
              选择左侧 Agent 查看信誉档案
            </div>
          ) : (
            <div className="max-w-3xl">
              {/* Agent 头部 */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-display text-2xl font-700 text-bright">{selected.name}</h2>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs font-mono uppercase tracking-wider text-dim">
                      {selected.verificationLevel}
                    </span>
                    <span className="text-dim">·</span>
                    <span className="text-xs font-mono text-dim">{selected.status}</span>
                    <span className="text-dim">·</span>
                    <span className="text-xs font-mono text-dim">注册于 {fmtTime(selected.createdAt)}</span>
                  </div>
                  {(selected.capabilities ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {(selected.capabilities ?? []).map((c) => (
                        <span key={c} className="text-xs rounded-full border border-edge px-2.5 py-0.5 text-dim font-mono">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 分数卡 */}
              <div className="mt-6 rounded-xl border border-edge bg-surface p-6">
                <div className="flex items-center gap-6">
                  <div>
                    <div className="text-dim text-xs font-mono uppercase tracking-wider mb-2">Credit Score</div>
                    <div className="flex items-baseline gap-1">
                      <span className={`font-mono text-6xl font-700 score-glow ${scoreTone(score?.score ?? null)}`}>
                        {score?.score ?? '—'}
                      </span>
                      <span className="text-dim text-sm font-mono">/1000</span>
                    </div>
                    {score?.score === null && (
                      <div className="text-dim text-xs font-mono mt-1">unverified（无证据）</div>
                    )}
                  </div>
                  <div className="ml-auto flex flex-col items-center gap-1">
                    <ScoreRing confidence={score?.confidence ?? 0} />
                    <span className="text-dim text-[11px] font-mono">confidence</span>
                  </div>
                </div>

                {/* 指标条 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-edge">
                  {[
                    ['Adjusted', score?.adjustedScore ?? null, ''],
                    ['Coverage', score ? `${Math.round(score.coverage * 100)}%` : '—', ''],
                    ['Freshness', score?.freshnessDays != null ? `${score.freshnessDays}d` : '—', ''],
                    ['Evidence', score?.evidenceCount ?? 0, ''],
                  ].map(([label, val]) => (
                    <div key={label as string}>
                      <div className="text-dim text-[11px] font-mono uppercase tracking-wider">{label}</div>
                      <div className="text-bright font-mono text-lg mt-1">{val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 维度分解 */}
              <div className="mt-6 rounded-xl border border-edge bg-surface p-6">
                <h3 className="font-display text-sm font-600 text-bright mb-4">维度分解</h3>
                <div className="space-y-3">
                  {dims.map((d) => (
                    <div key={d.dimension} className="flex items-center gap-3">
                      <div className="w-20 shrink-0 text-xs text-dim">{DIMENSION_LABELS[d.dimension] ?? d.dimension}</div>
                      <div className="flex-1 h-2 rounded-full bg-abyss overflow-hidden">
                        {d.score !== null ? (
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${d.score}%`,
                              background: d.score >= 70 ? '#34D399' : d.score >= 40 ? '#F4A261' : '#F87171',
                            }}
                          />
                        ) : (
                          <div className="h-full w-full" style={{ background: 'repeating-linear-gradient(90deg,#1a2230 0 6px,#141a24 6px 12px)' }} />
                        )}
                      </div>
                      <div className="w-12 shrink-0 text-right font-mono text-sm text-bright">
                        {d.score !== null ? d.score : <span className="text-dim">—</span>}
                      </div>
                      <div className="w-10 shrink-0 text-right font-mono text-[11px] text-dim">w{d.weight}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 提交 Evidence */}
              <div className="mt-6 rounded-xl border border-edge bg-surface p-6">
                <h3 className="font-display text-sm font-600 text-bright mb-4">提交 Evidence</h3>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={evDimension}
                    onChange={(e) => setEvDimension(e.target.value)}
                    className="rounded-md bg-abyss border border-edge px-3 py-2 text-sm text-bright focus:outline-none focus:border-accent/50"
                  >
                    {DIMENSIONS.map((d) => (
                      <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>
                    ))}
                  </select>
                  <select
                    value={evSource}
                    onChange={(e) => setEvSource(e.target.value)}
                    className="rounded-md bg-abyss border border-edge px-3 py-2 text-sm text-bright focus:outline-none focus:border-accent/50"
                  >
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
                    ))}
                  </select>
                  <select
                    value={evResult}
                    onChange={(e) => setEvResult(e.target.value)}
                    className="rounded-md bg-abyss border border-edge px-3 py-2 text-sm text-bright focus:outline-none focus:border-accent/50"
                  >
                    {RESULTS.map((r) => (
                      <option key={r} value={r}>{RESULT_LABELS[r]}</option>
                    ))}
                  </select>
                  <button
                    onClick={submitEvidence}
                    disabled={busy}
                    className="rounded-md bg-info/90 text-abyss font-semibold text-sm px-4 py-2 hover:bg-info disabled:opacity-40"
                  >
                    提交并重算
                  </button>
                </div>
              </div>

              {/* Evidence 时间线 */}
              <div className="mt-6 rounded-xl border border-edge bg-surface p-6">
                <h3 className="font-display text-sm font-600 text-bright mb-4">Evidence（{evidence.length}）</h3>
                {evidence.length === 0 ? (
                  <p className="text-dim text-sm">暂无证据</p>
                ) : (
                  <ol className="relative border-l border-edge ml-2 space-y-4">
                    {[...evidence].reverse().map((e) => (
                      <li key={e.id} className="ml-4">
                        <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-edge" />
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm text-bright">{DIMENSION_LABELS[e.dimension] ?? e.dimension}</span>
                          <span className="text-xs font-mono text-dim">{SOURCE_LABELS[e.source] ?? e.source}</span>
                          <span
                            className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                              e.result === 'success'
                                ? 'text-accent bg-accent/10'
                                : e.result === 'failure'
                                  ? 'text-danger bg-danger/10'
                                  : 'text-amber bg-amber/10'
                            }`}
                          >
                            {RESULT_LABELS[e.result] ?? e.result}
                          </span>
                          <span className="text-[11px] font-mono text-dim ml-auto">{fmtTime(e.createdAt)}</span>
                        </div>
                        {e.issuer && <div className="text-xs text-dim mt-0.5">issuer: {e.issuer}</div>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
