// Агенты: карточки, форма настроек (строится из schema сервера), проверка поведения без и с моделью.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { live } from '../state.js';
import { agentsStore, discardDraft, editDraft, loadAgents, previewAgent, resetAgent, saveAgent, selectAgent, testAgent, valuesFor } from '../agents-ui.js';
import { useStore } from '../lib/store.js';
import { cloneSettings, isDirty, summarizeSettings, testErrorMessage, TEST_TEXT_MAX } from '../lib/settings.js';
import { fmtNum, formatDateTime, isNum } from '../lib/format.js';
import { Button, ConfirmButton, Field, Icon, Notice, Pill, Segmented, Spinner, Toggle } from './ui.jsx';

const OLLAMA = {
  ready: { tone: 'ok', text: 'Ollama готова' },
  unavailable: { tone: 'bad', text: 'Ollama недоступна' },
  model_missing: { tone: 'warn', text: 'Модель не загружена' },
  not_configured: { tone: 'muted', text: 'Ollama не настроена' },
};

function OllamaBar({ ollama }) {
  if (!ollama) return null;
  const o = OLLAMA[ollama.state] ?? { tone: 'muted', text: ollama.state };
  return (
    <div class="agent-banner card">
      <Pill tone={o.tone} dot>{o.text}</Pill>
      <span class="meta">{ollama.model ? `Модель: ${ollama.model}` : 'Модель не указана'}</span>
      {ollama.message ? <span class="meta">{ollama.message}</span> : null}
      <span class="meta toolbar__spacer">Настройки можно менять и сохранять, даже если модель недоступна.</span>
    </div>
  );
}

/** ИИ-сервисы, не являющиеся собеседниками: у радио-редактора нет персоны и настроек личности, показывается только состояние. */
function ServicesPanel({ services }) {
  if (!services?.length) return null;
  return (
    <section class="card" aria-label="ИИ-сервисы" style="margin:0 0 12px">
      <h3 style="margin:0 0 8px">ИИ-сервисы</h3>
      {services.map((svc) => {
        const o = svc.ollama ? OLLAMA[svc.ollama.state] ?? { tone: 'muted', text: svc.ollama.state } : null;
        return (
          <div key={svc.id} class="agent-card" style="cursor:default">
            <span class="agent-card__head"><strong>{svc.name}</strong><span class="agent-card__id">{svc.id}</span></span>
            <span class="agent-card__role">{svc.description}</span>
            <span class="agent-card__tags">
              <Pill tone={svc.placed ? 'ok' : 'warn'} dot>{svc.placed ? `Работает в станции: ${svc.station}` : 'Не подключён'}</Pill>
              {o ? <Pill tone={o.tone} dot>{o.text}</Pill> : null}
              <Pill tone={svc.mode === 'ollama' ? 'ok' : 'info'}>
                {svc.mode === 'ollama' ? 'Сценарии готовит Ollama' : 'Сейчас: локальный учебный сценарий (без Ollama)'}
              </Pill>
              {svc.usesSharedOllama ? <Pill tone="muted">Общая очередь Ollama</Pill> : null}
            </span>
            <span class="meta">Это не собеседник: игрок не выбирает тему, поэтому настроек личности здесь нет.</span>
          </div>
        );
      })}
    </section>
  );
}

function PlacementPill({ placement }) {
  if (placement.status === 'placed') {
    const where = [placement.city ? 'Город' : null, placement.station].filter(Boolean).join(', ');
    return <Pill tone="ok" dot title="Персонаж реально размещён в мире">Размещён: {where}</Pill>;
  }
  return <Pill tone="warn" dot title="Персонаж не стоит ни в городе, ни в станции с заданием">Не размещён в мире</Pill>;
}

function AgentCard({ agent, schema, selected }) {
  const summary = summarizeSettings(agent.settings, schema);
  return (
    <button type="button" class="agent-card" aria-pressed={selected} onClick={() => selectAgent(agent.id)}>
      <span class="agent-card__head">
        <strong>{agent.name}</strong>
        <span class="agent-card__id">{agent.id}</span>
      </span>
      <span class="agent-card__role">{agent.role || 'Профессия не указана'}</span>
      <span class="agent-card__tags">
        <PlacementPill placement={agent.placement} />
        {agent.error ? <Pill tone="bad">Ошибка персоны</Pill> : null}
        {agent.customized ? <Pill tone="info">Настроен</Pill> : <Pill tone="muted">По умолчанию</Pill>}
      </span>
      {agent.placement.status !== 'placed' ? <span class="meta">В игре этого персонажа пока нет, поэтому он не считается активным NPC.</span> : null}
      <span class="agent-card__tags">
        {summary.map((s) => <Pill key={s.key} tone={s.tone ?? 'muted'} title={s.label}>{s.label}: {s.value}</Pill>)}
      </span>
    </button>
  );
}

// ── Поля формы ───────────────────────────────────────────────────────────────────────────────

function TagsEditor({ id, value, onChange, max, itemMax, disabled, describedBy }) {
  const [text, setText] = useState('');
  const items = value ?? [];
  const add = (raw) => {
    const t = raw.trim().slice(0, itemMax);
    if (!t || items.includes(t) || items.length >= max) return;
    onChange([...items, t]);
    setText('');
  };
  return (
    <div class="tags" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
      {items.map((t, i) => (
        <span class="tag" key={`${t}-${i}`}>
          {t}
          <button type="button" disabled={disabled} aria-label={`Удалить тему «${t}»`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
        </span>
      ))}
      <input id={id} type="text" value={text} maxLength={itemMax} disabled={disabled || items.length >= max} aria-describedby={describedBy}
        placeholder={items.length >= max ? 'Достигнут предел' : items.length ? 'Ещё тема…' : 'Введите тему и нажмите Enter'}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
          else if (e.key === 'Backspace' && !text && items.length) onChange(items.slice(0, -1));
        }}
        onBlur={() => add(text)} />
    </div>
  );
}

function SettingField({ field, value, error, disabled, onChange }) {
  const id = `set-${field.key}`;
  const describedBy = error ? `${id}-err` : field.help ? `${id}-help` : undefined;
  const wide = field.kind === 'longtext' || field.kind === 'list';
  let control = null;
  let counter = null;

  switch (field.kind) {
    case 'boolean':
      control = <Toggle id={id} checked={Boolean(value)} onChange={onChange} label={field.label} disabled={disabled} />;
      break;
    case 'text':
      counter = `${(value ?? '').length} / ${field.max}`;
      control = <input id={id} class="input" type="text" value={value ?? ''} maxLength={field.max} disabled={disabled} aria-describedby={describedBy} onInput={(e) => onChange(e.currentTarget.value)} />;
      break;
    case 'longtext':
      counter = `${(value ?? '').length} / ${field.max}`;
      control = <textarea id={id} class="textarea" value={value ?? ''} maxLength={field.max} disabled={disabled} aria-describedby={describedBy} onInput={(e) => onChange(e.currentTarget.value)} />;
      break;
    case 'list':
      counter = `${(value ?? []).length} / ${field.max}`;
      control = <TagsEditor id={id} value={value} onChange={onChange} max={field.max} itemMax={field.itemMax} disabled={disabled} describedBy={describedBy} />;
      break;
    case 'enum': {
      const options = field.values.map((v) => ({ value: v, label: field.labels?.[v] ?? v }));
      control = options.length <= 3
        ? <Segmented value={value} options={options} onChange={onChange} label={field.label} />
        : <select id={id} class="select" value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
      break;
    }
    case 'int': {
      const marks = [];
      for (let v = field.min; v <= field.max; v++) marks.push(v);
      control = (
        <div class="scale">
          <input id={id} type="range" min={field.min} max={field.max} step="1" value={value} disabled={disabled} aria-describedby={describedBy} aria-valuetext={`${value} из ${field.max}`} onInput={(e) => onChange(Number(e.currentTarget.value))} />
          <div class="scale__marks" aria-hidden="true">{marks.map((m) => <span key={m} class={m === value ? 'is-on' : ''}>{m}</span>)}</div>
        </div>
      );
      break;
    }
    case 'number': {
      const isDefault = value === null || value === undefined;
      control = (
        <div class="number-row">
          <label class="check"><input type="checkbox" checked={isDefault} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked ? null : field.max / 2)} />По умолчанию</label>
          <input id={id} type="range" min={field.min} max={field.max} step="0.05" value={isDefault ? field.max / 2 : value} disabled={disabled || isDefault} aria-label={`${field.label}: ползунок`} onInput={(e) => onChange(Number(e.currentTarget.value))} />
          <input type="number" class="input input--num" min={field.min} max={field.max} step="0.05" disabled={disabled || isDefault} value={isDefault ? '' : value} placeholder="авто" aria-label={`${field.label}: значение`}
            onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isFinite(n)) onChange(n); }} />
        </div>
      );
      break;
    }
    default:
      return null;
  }

  return (
    <Field id={id} label={field.label} help={field.help} error={error} counter={counter} class={wide ? 'field--wide' : ''}>
      {control}
    </Field>
  );
}

// ── Проверка поведения ───────────────────────────────────────────────────────────────────────

function TryPanel({ agent, draftValues, dirty }) {
  const [text, setText] = useState('Привет! Расскажи, чем ты занимаешься?');
  const [useDraft, setUseDraft] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [test, setTest] = useState(null);
  const [testBusy, setTestBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const abort = useRef(null);
  const withDraft = dirty && useDraft;
  const settings = withDraft ? draftValues : undefined;

  // при смене агента сбрасываем результаты
  useEffect(() => {
    abort.current?.abort();
    setPreview(null);
    setTest(null);
    setProblem('');
    setTestBusy(false);
  }, [agent.id]);
  useEffect(() => () => abort.current?.abort(), []);

  const runPreview = async () => {
    setPreviewBusy(true);
    setProblem('');
    const res = await previewAgent(agent, settings);
    setPreviewBusy(false);
    if (res.ok) setPreview({ ...res.preview, usedDraft: withDraft });
    else setProblem(res.fields ? `Черновик не прошёл проверку: ${Object.values(res.fields).join('; ')}` : res.error);
  };

  const runTest = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setTestBusy(true);
    setTest(null);
    setProblem('');
    const res = await testAgent(agent, trimmed, settings, ctl.signal);
    if (ctl.signal.aborted) return;
    setTestBusy(false);
    if (res.fields) setProblem(`Черновик не прошёл проверку: ${Object.values(res.fields).join('; ')}`);
    else setTest(res);
  };

  const cancelTest = () => {
    abort.current?.abort();
    setTestBusy(false);
    setProblem('Проверка отменена.');
  };

  return (
    <section class="card try" aria-label="Проверка поведения">
      <div>
        <h3 class="card__title">Проверка поведения</h3>
        <p class="card__sub">Тестовые реплики не попадают в память игроков и не меняют игру.</p>
      </div>
      <Field id="try-text" label="Реплика игрока" counter={`${text.length} / ${TEST_TEXT_MAX}`}>
        <textarea id="try-text" class="textarea" maxLength={TEST_TEXT_MAX} value={text} onInput={(e) => setText(e.currentTarget.value)} />
      </Field>
      <label class="check">
        <input type="checkbox" checked={useDraft} onChange={(e) => setUseDraft(e.currentTarget.checked)} />
        Проверять с несохранёнными настройками{dirty ? '' : ' (черновика нет — используются сохранённые)'}
      </label>
      <div class="try__row">
        <Button icon="eye" busy={previewBusy} onClick={runPreview}>Проверить промпт</Button>
        <Button variant="primary" icon="send" busy={testBusy} disabled={!text.trim()} onClick={runTest}>Спросить агента</Button>
        {testBusy ? <Button variant="ghost" small onClick={cancelTest}>Отменить</Button> : null}
        {testBusy ? <Spinner label="Ждём ответ модели, это может занять до 90 секунд…" /> : null}
      </div>
      <div aria-live="polite">{problem ? <Notice tone="warn">{problem}</Notice> : null}</div>

      {preview ? (
        <div class="try__result">
          <div class="try__row">
            <Pill tone={preview.enabled ? 'ok' : 'warn'}>{preview.enabled ? 'Агент доступен' : 'Агент выключен'}</Pill>
            <span class="meta">Имя в разговоре: {preview.name} · лимит токенов: {isNum(preview.numPredict) ? preview.numPredict : 'по умолчанию'} · температура: {isNum(preview.temperature) ? fmtNum(preview.temperature, 2) : 'по умолчанию'}</span>
            <span class="meta">{preview.usedDraft ? 'С черновиком' : 'С сохранёнными настройками'}; модель не вызывалась</span>
          </div>
          <h4 class="field__label">Итоговый системный промпт</h4>
          <pre class="prompt" tabIndex={0} aria-label="Системный промпт">{preview.systemPrompt}</pre>
        </div>
      ) : null}

      {test ? (
        <div class="try__result" aria-live="polite">
          {test.ok ? (
            <>
              <h4 class="field__label">Ответ модели</h4>
              <div class="reply">{test.text || 'Модель вернула пустой ответ.'}</div>
              <p class="meta">{fmtNum(test.durationMs / 1000, 1)} с · {test.usedDraft ? 'с черновиком настроек' : 'с сохранёнными настройками'}</p>
            </>
          ) : (
            <Notice tone="bad">{testErrorMessage(test.error)}</Notice>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ── Подробности агента ───────────────────────────────────────────────────────────────────────

function AgentDetail({ agent }) {
  const state = useStore(agentsStore);
  const { schema } = state;
  const values = valuesFor(state, agent);
  const dirty = useMemo(() => state.drafts[agent.id] !== undefined && isDirty(values, agent.settings, schema), [state.drafts, agent, values, schema]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { tone, text, conflict }
  const [fields, setFields] = useState({});
  const stale = state.drafts[agent.id] && state.drafts[agent.id].baseRevision !== agent.revision;

  useEffect(() => {
    setResult(null);
    setFields({});
  }, [agent.id]);

  const change = (key, value) => {
    setResult(null);
    if (fields[key]) setFields(({ [key]: _gone, ...rest }) => rest);
    editDraft(agent, { [key]: value });
  };

  const save = async () => {
    setBusy(true);
    setResult(null);
    const res = await saveAgent(agent);
    setBusy(false);
    if (res.ok) {
      setFields({});
      setResult({ tone: 'ok', text: 'Настройки сохранены. Новые реплики агента используют их сразу.' });
    } else {
      setFields(res.fields ?? {});
      setResult({ tone: 'bad', text: res.fields ? 'Исправьте отмеченные поля.' : res.error, conflict: res.conflict });
    }
  };

  const reset = async () => {
    setBusy(true);
    setResult(null);
    const res = await resetAgent(agent);
    setBusy(false);
    setFields({});
    setResult(res.ok ? { tone: 'ok', text: 'Настройки сброшены к значениям по умолчанию.' } : { tone: 'bad', text: res.error });
  };

  const refresh = async () => {
    discardDraft(agent.id);
    setResult(null);
    await loadAgents({ silent: true });
  };

  const locked = Boolean(agent.error);
  return (
    <div class="agent-detail">
      <section class="card">
        <div class="agent-card__head">
          <div>
            <h2 class="card__title" style="font-size:18px">{agent.name}</h2>
            <p class="agent-card__role">{agent.role || 'Профессия не указана'} · <span class="agent-card__id">{agent.id}</span></p>
          </div>
          <PlacementPill placement={agent.placement} />
        </div>
        {agent.placement.status !== 'placed' ? <p class="meta" style="margin-top:8px">Персонаж не размещён в мире: настройки сохраняются, но игроки его пока не встретят.</p> : null}
        {agent.error ? <div style="margin-top:10px"><Notice tone="bad">Не удалось загрузить персону: {String(agent.error)}</Notice></div> : null}
        <div class="persona" style="margin-top:12px">
          <p class="persona__base">База персоны (из файла агента). Настройки ниже только дополняют её и не заменяют системные правила игры.</p>
          {agent.about ? <div class="persona__row"><b>Описание</b><span>{agent.about}</span></div> : null}
          {agent.style ? <div class="persona__row"><b>Манера речи</b><span>{agent.style}</span></div> : null}
          {agent.topics?.length ? <div class="persona__row"><b>Темы</b><span>{agent.topics.join(', ')}</span></div> : null}
        </div>
      </section>

      <section class="card" aria-label="Настройки агента">
        <h3 class="card__title">Настройки поведения</h3>
        <p class="card__sub">{agent.customized ? `Изменены ${formatDateTime(agent.updatedAt)}` : 'Сейчас действуют значения по умолчанию'} · версия {agent.revision}</p>
        <div class="form-grid">
          {schema.map((f) => (
            <SettingField key={f.key} field={f} value={values[f.key]} error={fields[f.key]} disabled={locked || busy} onChange={(v) => change(f.key, v)} />
          ))}
        </div>
        {stale ? <div style="margin-top:12px"><Notice tone="warn" action={<Button small onClick={refresh}>Загрузить актуальные</Button>}>Настройки изменены на сервере, пока вы редактировали. Сохранение будет отклонено.</Notice></div> : null}
        <div style="margin-top:12px" aria-live="polite">
          {result && result.tone !== 'ok' ? <Notice tone={result.tone} action={result.conflict ? <Button small onClick={refresh}>Обновить</Button> : null}>{result.text}</Notice> : null}
        </div>
        <div class="form-actions">
          <Button variant="primary" icon="check" busy={busy} disabled={!dirty || locked} onClick={save}>Сохранить</Button>
          <Button disabled={!dirty || busy} onClick={() => { discardDraft(agent.id); setFields({}); setResult(null); }}>Отменить изменения</Button>
          <ConfirmButton label="Сбросить к умолчанию" question="Сбросить все настройки агента?" confirmLabel="Да, сбросить" icon="refresh" disabled={locked || busy || (!agent.customized && !dirty)} onConfirm={reset} />
          <span class="form-actions__status" aria-live="polite">
            {dirty ? <span class="draft-mark">Черновик: есть несохранённые изменения</span> : result?.tone === 'ok' ? <span class="saved-mark">{result.text}</span> : 'Нет несохранённых изменений'}
          </span>
        </div>
      </section>

      <TryPanel agent={agent} draftValues={cloneSettings(values)} dirty={dirty} />
    </div>
  );
}

export function Agents() {
  const state = useStore(agentsStore);
  const stamp = useStore(live, (s) => s.agentsStamp);
  const snapshots = useStore(live, (s) => s.snapshots);
  const first = useRef(true);

  useEffect(() => {
    void loadAgents({ silent: !first.current });
    first.current = false;
  }, [stamp, snapshots]);

  if (state.status === 'idle' || (state.status === 'loading' && !state.agents.length)) return <div class="page-loading"><Spinner label="Загружаем агентов…" /></div>;
  if (state.status === 'error') {
    return <div class="page-loading"><Notice tone="bad" action={<Button small icon="refresh" onClick={() => loadAgents()}>Повторить</Button>}>{state.error}</Notice></div>;
  }
  const agent = state.agents.find((a) => a.id === state.selectedId) ?? state.agents[0];
  if (!agent) return <div class="card"><p class="empty"><strong>Нет данных: агенты не настроены</strong></p></div>;

  return (
    <div class="agents-page">
      <OllamaBar ollama={state.ollama} />
      <ServicesPanel services={state.services} />
      <p class="meta" style="margin:8px 0 12px">
        {state.summary ? `Агентов настроено: ${state.summary.configured}, размещено в мире: ${state.summary.placed}, активных: ${state.summary.active}.` : ''}
        {' '}Не размещённые в мире персонажи не считаются активными NPC.
      </p>
      <div class="agents">
        <div class="agent-list" role="list" aria-label="Список агентов">
          {state.agents.map((a) => <div role="listitem" key={a.id}><AgentCard agent={a} schema={state.schema} selected={a.id === agent.id} /></div>)}
        </div>
        <AgentDetail key={agent.id} agent={agent} />
      </div>
    </div>
  );
}
