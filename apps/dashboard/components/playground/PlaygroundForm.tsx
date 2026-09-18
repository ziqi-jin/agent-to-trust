'use client';

import { useEffect, useState } from 'react';
import {
  api,
  type PlaygroundSessionBody,
  type PlaygroundTemplate,
} from '@/lib/api';
import { useLocale, useT, fill } from '@/lib/i18n';
import { InfoDot } from '@/components/InfoDot';
import { ArrowRight, Loader2 } from 'lucide-react';

type Mode = 'template' | 'custom';
type Style = 'tough' | 'balanced' | 'gentle';

const INPUT_CLS = 'input';

const LABEL_CLS = 'flex items-center font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-dim';

/** 表单分节卡：编号圆点 + 标题。 */
function FormSection({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card animate-fade-up p-5 md:p-6" style={{ animationDelay: `${n * 80}ms` }}>
      <p className="flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink">
        <span className="grid h-6 w-6 place-items-center rounded-[4px] bg-ledger text-[11px] font-bold text-paper">
          {n}
        </span>
        {title}
      </p>
      {children}
    </section>
  );
}

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
  const t = useT();
  const { locale } = useLocale();
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<Mode>('template');
  const [templates, setTemplates] = useState<PlaygroundTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [custom, setCustom] = useState<CustomDraft>(EMPTY_CUSTOM);
  const [style, setStyle] = useState<Style>('balanced');
  const [formError, setFormError] = useState<string | null>(null);

  // 启动即拉官方模板（随语言切换重拉，后端按 locale 本地化）
  useEffect(() => {
    let alive = true;
    setTemplates(null);
    setTemplatesError(null);
    api
      .playgroundTemplates(locale)
      .then((r) => {
        if (alive) setTemplates(r.templates);
      })
      .catch(() => {
        if (alive) setTemplatesError(t.playground.form.templatesError);
      });
    return () => {
      alive = false;
    };
  }, [locale, t]);

  const selectedTemplate = templates?.find((tmpl) => tmpl.id === templateId) ?? null;

  /** 选中模板即预填自定义字段：翻到「自定义参数」即可在模板基础上微调。 */
  const prefillFromTemplate = (tmpl: PlaygroundTemplate) => {
    setCustom({
      brief: tmpl.scenario.brief,
      agentRole: tmpl.scenario.agentRole,
      counterpartRole: tmpl.scenario.counterpartRole,
      metricLabel: tmpl.scenario.metricLabel,
      opening: String(tmpl.scenario.strategy.opening),
      floor: String(tmpl.scenario.strategy.floor),
      target: String(tmpl.scenario.strategy.target),
      maxRounds: String(tmpl.scenario.maxRounds),
    });
  };

  const onTemplateChange = (id: string) => {
    setTemplateId(id);
    setFormError(null);
    const tmpl = templates?.find((x) => x.id === id);
    if (tmpl) prefillFromTemplate(tmpl);
  };

  const setCustomField = (key: keyof CustomDraft, value: string) =>
    setCustom((c) => ({ ...c, [key]: value }));

  const buildBody = (): { scenario: PlaygroundSessionBody['scenario'] } | string => {
    const ep = endpoint.trim();
    if (!ep) return t.playground.form.validation.endpointRequired;
    if (!/^https?:\/\//i.test(ep)) return t.playground.form.validation.endpointProtocol;
    if (mode === 'template' && !templateId) return t.playground.form.validation.chooseTemplate;

    if (mode === 'custom') {
      const brief = custom.brief.trim();
      const agentRole = custom.agentRole.trim();
      const counterpartRole = custom.counterpartRole.trim();
      const metricLabel = custom.metricLabel.trim();
      if (!brief || !agentRole || !counterpartRole || !metricLabel)
        return t.playground.form.validation.customRequired;

      const opening = Number(custom.opening);
      const floor = Number(custom.floor);
      const target = Number(custom.target);
      const maxRounds = Number(custom.maxRounds);
      if (!Number.isFinite(opening) || !Number.isFinite(floor) || !Number.isFinite(target))
        return t.playground.form.validation.numbersRequired;
      if (opening <= 0 || floor <= 0 || target <= 0)
        return t.playground.form.validation.positiveOnly;
      if (!(floor < target && target <= opening))
        return t.playground.form.validation.floorTarget;
      if (!Number.isInteger(maxRounds) || maxRounds < 2 || maxRounds > 8)
        return t.playground.form.validation.roundsRange;

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
    const trimmedModel = model.trim();
    onSubmit({
      ...(trimmedName ? { name: trimmedName.slice(0, 60) } : {}),
      endpoint: endpoint.trim(),
      ...(trimmedKey ? { apiKey: trimmedKey } : {}),
      ...(trimmedModel ? { model: trimmedModel } : {}),
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
      aria-pressed={mode === m}
      className={`relative z-10 rounded-[4px] px-4 py-2 uppercase tracking-[0.1em] transition-colors duration-300 ${
        mode === m ? 'font-semibold text-paper' : 'text-dim hover:text-ink'
      }`}
    >
      {label}
    </button>
  );

  const f = t.playground.form;

  return (
    <div className="flex flex-col gap-4">
      {/* 被测 agent */}
      <FormSection n={1} title={f.sectionAgent.replace(/^§PG-\d+\s*—\s*/, '')}>
        <div className="mt-5 flex flex-col gap-4">
          <label>
            <span className={LABEL_CLS}>
              {f.nameLabel}
              <InfoDot text={f.hints.name} />
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="my-agent"
              className={INPUT_CLS}
            />
          </label>
          <label>
            <span className={LABEL_CLS}>
              {f.endpointLabel}
              <InfoDot text={f.hints.endpoint} />
            </span>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={f.endpointPlaceholder}
              spellCheck={false}
              className={INPUT_CLS}
            />
            <span className="mt-1.5 block text-[11px] leading-relaxed text-dim">
              {f.endpointHelper}
            </span>
          </label>
          <label>
            <span className={LABEL_CLS}>
              {f.apiKeyLabel}
              <InfoDot text={f.hints.apiKey} />
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              placeholder={f.apiKeyPlaceholder}
              className={INPUT_CLS}
            />
            <span className="mt-1.5 block text-[11px] leading-relaxed text-dim">
              {f.apiKeyHelper}
            </span>
          </label>
          <label>
            <span className={LABEL_CLS}>
              {f.modelLabel}
              <InfoDot text={f.hints.model} />
            </span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              autoComplete="off"
              placeholder={f.modelPlaceholder}
              className={INPUT_CLS}
            />
            <span className="mt-1.5 block text-[11px] leading-relaxed text-dim">
              {f.modelHelper}
            </span>
          </label>
        </div>
      </FormSection>

      {/* 场景来源 */}
      <FormSection n={2} title={f.sectionScenario.replace(/^§PG-\d+\s*—\s*/, '')}>
        <div className="relative mt-5 grid grid-cols-2 rounded-md border border-line-strong bg-night p-1 font-mono text-[11px] font-medium">
          <span
            aria-hidden
            className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-[4px] bg-ledger shadow-glow-sm transition-transform duration-300 ease-out-expo ${
              mode === 'custom' ? 'translate-x-full' : ''
            }`}
          />
          {modeBtn('template', f.tabTemplate)}
          {modeBtn('custom', f.tabCustom)}
        </div>

        {mode === 'template' ? (
          <div className="mt-4">
            {templatesError ? (
              <p className="rounded-xl border border-seal/30 bg-seal/5 px-3 py-2.5 text-xs text-seal">
                {templatesError}
              </p>
            ) : templates === null ? (
              <p className="h-11 animate-pulse rounded-md bg-panel px-3 py-3 font-mono text-xs text-dim">
                {f.loadingTemplates}
              </p>
            ) : templates.length === 0 ? (
              <p className="rounded-md border border-dashed border-line-strong px-3 py-3 font-mono text-xs text-dim">
                {f.noTemplates}
              </p>
            ) : (
              <>
                <label>
                  <span className={LABEL_CLS}>
                    {f.chooseScenario}
                    <InfoDot text={f.hints.chooseScenario} />
                  </span>
                  <select
                    value={templateId}
                    onChange={(e) => onTemplateChange(e.target.value)}
                    className={INPUT_CLS}
                  >
                    <option value="" disabled>
                      {f.chooseTemplate}
                    </option>
                    {templates.map((tmpl) => (
                      <option key={tmpl.id} value={tmpl.id}>
                        {tmpl.name} — {tmpl.desc}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedTemplate && (
                  <div className="mt-3 animate-pop-in rounded-xl border border-ledger/15 bg-ledger-soft/50 p-4">
                    <p className="text-[13px] leading-relaxed text-ink">
                      {selectedTemplate.scenario.brief}
                    </p>
                    <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] leading-relaxed text-dim">
                      <div>{fill(f.detailYou, { v: selectedTemplate.scenario.agentRole })}</div>
                      <div>{fill(f.detailOpponent, { v: selectedTemplate.scenario.counterpartRole })}</div>
                      <div>{fill(f.detailMetric, { v: selectedTemplate.scenario.metricLabel })}</div>
                      <div>{fill(f.detailRounds, { v: selectedTemplate.scenario.maxRounds })}</div>
                      <div>{fill(f.detailOpening, { v: selectedTemplate.scenario.strategy.opening })}</div>
                      <div>{fill(f.detailFloor, { v: selectedTemplate.scenario.strategy.floor })}</div>
                      <div>{fill(f.detailTarget, { v: selectedTemplate.scenario.strategy.target })}</div>
                    </dl>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <label>
              <span className={LABEL_CLS}>
                {f.briefLabel}
                <InfoDot text={f.hints.brief} />
              </span>
              <textarea
                value={custom.brief}
                onChange={(e) => setCustomField('brief', e.target.value)}
                rows={3}
                placeholder={f.briefPlaceholder}
                className={`${INPUT_CLS} resize-y`}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className={LABEL_CLS}>
                  {f.agentRoleLabel}
                  <InfoDot text={f.hints.agentRole} />
                </span>
                <input
                  value={custom.agentRole}
                  onChange={(e) => setCustomField('agentRole', e.target.value)}
                  placeholder={f.agentRolePlaceholder}
                  className={INPUT_CLS}
                />
              </label>
              <label>
                <span className={LABEL_CLS}>
                  {f.counterpartRoleLabel}
                  <InfoDot text={f.hints.counterpartRole} />
                </span>
                <input
                  value={custom.counterpartRole}
                  onChange={(e) => setCustomField('counterpartRole', e.target.value)}
                  placeholder={f.counterpartRolePlaceholder}
                  className={INPUT_CLS}
                />
              </label>
            </div>
            <label>
              <span className={LABEL_CLS}>
                {f.metricLabel}
                <InfoDot text={f.hints.metric} />
              </span>
              <input
                value={custom.metricLabel}
                onChange={(e) => setCustomField('metricLabel', e.target.value)}
                placeholder={f.metricPlaceholder}
                className={INPUT_CLS}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label>
                <span className={LABEL_CLS}>
                  {f.openingLabel}
                  <InfoDot text={f.hints.opening} />
                </span>
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
                <span className={LABEL_CLS}>
                  {f.floorLabel}
                  <InfoDot text={f.hints.floor} />
                </span>
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
                <span className={LABEL_CLS}>
                  {f.targetLabel}
                  <InfoDot text={f.hints.target} />
                </span>
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
            <p className="font-mono text-[11px] text-dim">{f.floorTargetHint}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className={LABEL_CLS}>
                  {f.roundsLabel}
                  <InfoDot text={f.hints.rounds} />
                </span>
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
                <span className={LABEL_CLS}>
                  {f.styleLabel}
                  <InfoDot text={f.hints.style} />
                </span>
                <div className="mt-1.5 flex gap-1">
                  {f.styles.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStyle(s.value as Style)}
                      title={s.desc}
                      aria-pressed={style === s.value}
                      className={`flex-1 rounded-xl border px-1 py-2 text-xs transition-all duration-200 ${
                        style === s.value
                          ? 'border-ledger bg-ledger-soft font-bold text-ledger shadow-glow-sm'
                          : 'border-hairline bg-surface text-dim hover:-translate-y-0.5 hover:border-line-strong hover:text-ink'
                      }`}
                    >
                      <span className="block">{s.label}</span>
                      <span
                        className={`mt-0.5 block text-[11px] leading-tight ${
                          style === s.value ? 'text-ledger/80' : 'text-dim'
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
      </FormSection>

      {/* 提交 */}
      <section className="px-1">
        {formError && (
          <p className="mb-3 animate-pop-in rounded-xl border border-seal/30 bg-seal/5 px-3 py-2 text-xs text-seal">
            {formError}
          </p>
        )}
        <button type="button" onClick={submit} disabled={submitting} className="btn-primary group w-full py-3.5">
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : null}
          {submitting ? f.submitting : f.submit.replace(/\s*[▸→]\s*$/, '')}
          {!submitting && (
            <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
          )}
        </button>
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-dim">{f.footnote}</p>
      </section>
    </div>
  );
}
