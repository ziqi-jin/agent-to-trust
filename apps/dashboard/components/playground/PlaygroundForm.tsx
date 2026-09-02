'use client';

import { useEffect, useState } from 'react';
import {
  api,
  type PlaygroundSessionBody,
  type PlaygroundTemplate,
} from '@/lib/api';

type Mode = 'template' | 'custom';
type Style = 'tough' | 'balanced' | 'gentle';

const INPUT_CLS =
  'mt-1.5 w-full border border-hairline bg-panel px-2.5 py-2 text-sm text-ink placeholder:text-dim/60 focus:border-ledger focus:outline-none';

const STYLE_OPTIONS: Array<{ value: Style; label: string; desc: string }> = [
  { value: 'tough', label: '强硬', desc: '让步慢 · 每轮 10%' },
  { value: 'balanced', label: '均衡', desc: '标准节奏 · 每轮 25%' },
  { value: 'gentle', label: '温和', desc: '让步快 · 每轮 40%' },
];

const LABEL_CLS = 'block font-mono text-[11px] uppercase tracking-[0.18em] text-dim';

/** 自定义场景字段（数值先用字符串承载，提交时再解析）。 */
interface CustomDraft {
  brief: string;
  agentRole: string;
  counterpartRole: string;
  metricLabel: string;
  opening: string;
  floor: string;
  target: string;
  maxRounds: string;
}

const EMPTY_CUSTOM: CustomDraft = {
  brief: '',
  agentRole: '',
  counterpartRole: '',
  metricLabel: '',
  opening: '',
  floor: '',
  target: '',
  maxRounds: '4',
};

export function PlaygroundForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (body: PlaygroundSessionBody) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState<Mode>('template');
  const [templates, setTemplates] = useState<PlaygroundTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [custom, setCustom] = useState<CustomDraft>(EMPTY_CUSTOM);
  const [style, setStyle] = useState<Style>('balanced');
  const [formError, setFormError] = useState<string | null>(null);

  // 启动即拉官方模板
  useEffect(() => {
    let alive = true;
    api
      .playgroundTemplates()
      .then((r) => {
        if (alive) setTemplates(r.templates);
      })
      .catch(() => {
        if (alive)
          setTemplatesError('模板拉取失败——可切到「自定义参数」手动建场景。');
      });
    return () => {
      alive = false;
    };
  }, []);

  const selectedTemplate = templates?.find((t) => t.id === templateId) ?? null;

  /** 选中模板即预填自定义字段：翻到「自定义参数」即可在模板基础上微调。 */
  const prefillFromTemplate = (t: PlaygroundTemplate) => {
    setCustom({
      brief: t.scenario.brief,
      agentRole: t.scenario.agentRole,
      counterpartRole: t.scenario.counterpartRole,
      metricLabel: t.scenario.metricLabel,
      opening: String(t.scenario.strategy.opening),
      floor: String(t.scenario.strategy.floor),
      target: String(t.scenario.strategy.target),
      maxRounds: String(t.scenario.maxRounds),
    });
  };

  const onTemplateChange = (id: string) => {
    setTemplateId(id);
    setFormError(null);
    const t = templates?.find((x) => x.id === id);
    if (t) prefillFromTemplate(t);
  };

  const setCustomField = (key: keyof CustomDraft, value: string) =>
    setCustom((c) => ({ ...c, [key]: value }));

  const buildBody = (): { scenario: PlaygroundSessionBody['scenario'] } | string => {
    const ep = endpoint.trim();
    if (!ep) return 'endpoint 必填。';
    if (!/^https?:\/\//i.test(ep)) return 'endpoint 需以 http(s):// 开头。';
    if (mode === 'template' && !templateId) return '请选择一个官方模板，或切到自定义参数。';

    if (mode === 'custom') {
      const brief = custom.brief.trim();
      const agentRole = custom.agentRole.trim();
      const counterpartRole = custom.counterpartRole.trim();
      const metricLabel = custom.metricLabel.trim();
      if (!brief || !agentRole || !counterpartRole || !metricLabel)
        return '自定义场景：brief / 你方角色 / 对手角色 / 指标名 都必填。';

      const opening = Number(custom.opening);
      const floor = Number(custom.floor);
      const target = Number(custom.target);
      const maxRounds = Number(custom.maxRounds);
      if (!Number.isFinite(opening) || !Number.isFinite(floor) || !Number.isFinite(target))
        return '开价 / 底线 / 目标价必须是数字。';
      if (opening <= 0 || floor <= 0 || target <= 0) return '数值都必须大于 0。';
      if (!(floor < target && target <= opening)) return '需满足：底线 < 目标价 ≤ 对手开价。';
      if (!Number.isInteger(maxRounds) || maxRounds < 2 || maxRounds > 8)
        return '回合数取 2–8 的整数。';

      return {
        scenario: {
          custom: {
            brief,
            agentRole,
            counterpartRole,
            metricLabel,
            opening,
            floor,
            target,
            maxRounds,
            style,
          },
        },
      };
    }

    return { scenario: { templateId } };
  };

  const submit = () => {
    setFormError(null);
    const bodyOrErr = buildBody();
    if (typeof bodyOrErr === 'string') {
      setFormError(bodyOrErr);
      return;
    }
    const trimmedName = name.trim();
    const trimmedKey = apiKey.trim();
    onSubmit({
      ...(trimmedName ? { name: trimmedName.slice(0, 60) } : {}),
      endpoint: endpoint.trim(),
      ...(trimmedKey ? { apiKey: trimmedKey } : {}),
      scenario: bodyOrErr.scenario,
    });
  };

  const modeBtn = (m: Mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => {
        setMode(m);
        setFormError(null);
      }}
      className={
        mode === m
          ? 'px-4 py-2 uppercase tracking-widest transition bg-ink text-paper'
          : 'border border-hairline px-4 py-2 uppercase tracking-widest text-dim transition hover:text-ink'
      }
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-8">
      {/* 被测 agent */}
      <section>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
          §PG-1 — 被测 AGENT
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <label>
            <span className={LABEL_CLS}>显示名 · NAME（可选）</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="my-agent"
              className={INPUT_CLS}
            />
          </label>
          <label>
            <span className={LABEL_CLS}>Endpoint *</span>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://your-agent.example.com/v1/chat/completions"
              spellCheck={false}
              className={INPUT_CLS}
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-dim">
              OpenAI chat-completions 兼容地址 · agent 零改动，同考场 --url 模式
            </span>
          </label>
          <label>
            <span className={LABEL_CLS}>API Key（可选）</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              placeholder="sk-…（Bearer）"
              className={INPUT_CLS}
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-dim">
              key 即用即弃：只进本次对局内存，不落存储、不进日志
            </span>
          </label>
        </div>
      </section>

      {/* 场景来源 */}
      <section>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
          §PG-2 — 场景来源 SCENARIO
        </p>
        <div className="mt-4 flex gap-1 font-mono text-xs">
          {modeBtn('template', '官方模板')}
          {modeBtn('custom', '自定义参数')}
        </div>

        {mode === 'template' ? (
          <div className="mt-4">
            {templatesError ? (
              <p className="border border-seal/50 bg-seal/10 px-3 py-2 text-xs text-seal">
                {templatesError}
              </p>
            ) : templates === null ? (
              <p className="border border-dashed border-hairline px-3 py-3 font-mono text-xs text-dim">
                正在拉取官方模板…
              </p>
            ) : templates.length === 0 ? (
              <p className="border border-dashed border-hairline px-3 py-3 font-mono text-xs text-dim">
                暂无官方模板——切到「自定义参数」建场景。
              </p>
            ) : (
              <>
                <label>
                  <span className={LABEL_CLS}>选择场景</span>
                  <select
                    value={templateId}
                    onChange={(e) => onTemplateChange(e.target.value)}
                    className={INPUT_CLS}
                  >
                    <option value="" disabled>
                      选择模板…
                    </option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.desc}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedTemplate && (
                  <div className="mt-3 border border-hairline bg-panel p-3">
                    <p className="text-[13px] leading-relaxed text-ink">
                      {selectedTemplate.scenario.brief}
                    </p>
                    <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] leading-relaxed text-dim">
                      <div>你方：{selectedTemplate.scenario.agentRole}</div>
                      <div>对手：{selectedTemplate.scenario.counterpartRole}</div>
                      <div>指标：{selectedTemplate.scenario.metricLabel}</div>
                      <div>回合：≤ {selectedTemplate.scenario.maxRounds}</div>
                      <div>对手开价：{selectedTemplate.scenario.strategy.opening}</div>
                      <div>对手底线：{selectedTemplate.scenario.strategy.floor}</div>
                      <div>你的目标：≤ {selectedTemplate.scenario.strategy.target}</div>
                    </dl>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <label>
              <span className={LABEL_CLS}>谈判背景 BRIEF *</span>
              <textarea
                value={custom.brief}
                onChange={(e) => setCustomField('brief', e.target.value)}
                rows={3}
                placeholder="你要为公司采购 100 把定制机械键盘，正在和供应商谈单价…"
                className={`${INPUT_CLS} resize-y`}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className={LABEL_CLS}>你方角色 *</span>
                <input
                  value={custom.agentRole}
                  onChange={(e) => setCustomField('agentRole', e.target.value)}
                  placeholder="采购经理"
                  className={INPUT_CLS}
                />
              </label>
              <label>
                <span className={LABEL_CLS}>对手角色 *</span>
                <input
                  value={custom.counterpartRole}
                  onChange={(e) => setCustomField('counterpartRole', e.target.value)}
                  placeholder="供应商销售"
                  className={INPUT_CLS}
                />
              </label>
            </div>
            <label>
              <span className={LABEL_CLS}>指标名 METRIC *</span>
              <input
                value={custom.metricLabel}
                onChange={(e) => setCustomField('metricLabel', e.target.value)}
                placeholder="单价（元）"
                className={INPUT_CLS}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label>
                <span className={LABEL_CLS}>对手开价 *</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={custom.opening}
                  onChange={(e) => setCustomField('opening', e.target.value)}
                  placeholder="100"
                  className={INPUT_CLS}
                />
              </label>
              <label>
                <span className={LABEL_CLS}>对手底线 *</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={custom.floor}
                  onChange={(e) => setCustomField('floor', e.target.value)}
                  placeholder="55"
                  className={INPUT_CLS}
                />
              </label>
              <label>
                <span className={LABEL_CLS}>你的目标价 *</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={custom.target}
                  onChange={(e) => setCustomField('target', e.target.value)}
                  placeholder="65"
                  className={INPUT_CLS}
                />
              </label>
            </div>
            <p className="font-mono text-[11px] text-dim">须满足：底线 &lt; 目标价 ≤ 对手开价</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className={LABEL_CLS}>回合数（2–8）</span>
                <input
                  type="number"
                  min="2"
                  max="8"
                  step="1"
                  value={custom.maxRounds}
                  onChange={(e) => setCustomField('maxRounds', e.target.value)}
                  className={INPUT_CLS}
                />
              </label>
              <div>
                <span className={LABEL_CLS}>对手风格</span>
                <div className="mt-1.5 flex gap-1">
                  {STYLE_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStyle(s.value)}
                      title={s.desc}
                      className={
                        style === s.value
                          ? 'flex-1 px-1 py-2 text-xs font-bold transition bg-ink text-paper'
                          : 'flex-1 border border-hairline px-1 py-2 text-xs text-dim transition hover:text-ink'
                      }
                    >
                      <span className="block">{s.label}</span>
                      <span
                        className={`mt-0.5 block text-[10px] leading-tight ${
                          style === s.value ? 'text-paper/70' : 'text-dim'
                        }`}
                      >
                        {s.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 提交 */}
      <section>
        {formError && <p className="mb-3 text-xs text-seal">{formError}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="w-full bg-ledger px-5 py-3 text-sm font-bold text-paper transition hover:bg-[#254a3e] disabled:opacity-40"
        >
          {submitting ? '开跑中…' : '开跑 ▸'}
        </button>
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-dim">
          自测场结果不进官方榜，只出评分卡 · 每 IP 同时 2 局 / 每小时 10 局
        </p>
      </section>
    </div>
  );
}
